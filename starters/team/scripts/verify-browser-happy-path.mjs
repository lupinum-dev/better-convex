import { spawn } from 'node:child_process'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

import { chromium } from 'playwright'

const rootUrl = process.env.STARTER_BROWSER_URL ?? 'http://localhost:3000'
const convexCloudPort = Number(process.env.STARTER_CONVEX_CLOUD_PORT ?? 3210)
const convexSitePort = Number(process.env.STARTER_CONVEX_SITE_PORT ?? 3211)
const nuxtPort = Number(new URL(rootUrl).port || 80)
const defaultAuthSecrets = '0:starter-browser-smoke-secret-local-only-32chars'
const browserViewport = process.argv.includes('--mobile')
  ? 'mobile'
  : (process.env.STARTER_BROWSER_VIEWPORT ?? 'desktop')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const processes = []
let devServerOutput = ''

function starterEnvironment() {
  return {
    ...process.env,
    SITE_URL: rootUrl,
    BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS ?? defaultAuthSecrets,
    VITE_CONVEX_URL: `http://127.0.0.1:${convexCloudPort}`,
    VITE_CONVEX_SITE_URL: `http://127.0.0.1:${convexSitePort}`,
    NUXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${convexCloudPort}`,
    NUXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${convexSitePort}`,
  }
}

function stripAnsi(value) {
  const text = stripVTControlCharacters(value)
  const secret = process.env.BETTER_AUTH_SECRETS ?? defaultAuthSecrets
  return secret ? text.replaceAll(secret, '[REDACTED]') : text
}

function getDevServerOutput() {
  return devServerOutput
}

function log(name, chunk) {
  const text = stripAnsi(String(chunk))
  devServerOutput += text
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) console.log(`[${name}] ${line}`)
  }
}

async function assertPortFree(port, label) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => {
      reject(new Error(`${label} port ${port} is already in use`))
    })
    server.once('listening', () => {
      server.close(resolve)
    })
    server.listen(port, '127.0.0.1')
  })
}

function startProcess(name, args, readyPattern, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, {
      cwd: process.cwd(),
      env: starterEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    processes.push(child)
    let output = ''
    let ready = false

    const timer = setTimeout(() => {
      if (ready) return
      reject(new Error(`${name} did not become ready within ${timeoutMs}ms\n${output}`))
    }, timeoutMs)

    function onData(chunk) {
      const text = stripAnsi(String(chunk))
      output += text
      log(name, text)
      if (/Would you like to link it now\?/.test(text)) {
        child.stdin.write('n\n')
      }
      if (!ready && readyPattern.test(output)) {
        ready = true
        clearTimeout(timer)
        resolve(child)
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (!ready) reject(new Error(`${name} exited before ready with code ${code}\n${output}`))
    })
  })
}

function runProcess(name, args, timeoutMs = 30_000, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, {
      cwd: process.cwd(),
      env: options.env ?? starterEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end(options.input === undefined ? undefined : `${options.input}\n`)

    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${name} did not finish within ${timeoutMs}ms\n${output}`))
    }, timeoutMs)

    function onData(chunk) {
      const text = stripAnsi(String(chunk))
      output += text
      log(name, text)
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(output)
        return
      }
      reject(new Error(`${name} exited with code ${code}\n${output}`))
    })
  })
}

async function stopProcesses() {
  await Promise.all(
    processes.reverse().map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode) {
            resolve()
            return
          }
          const timer = setTimeout(() => {
            child.kill('SIGTERM')
            resolve()
          }, 2_000)
          child.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
          child.kill('SIGINT')
        }),
    ),
  )
}

function getBrowserContextOptions() {
  if (browserViewport !== 'mobile') return {}

  return {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  }
}

async function configureConvexAuthEnv() {
  const authSecrets = process.env.BETTER_AUTH_SECRETS ?? defaultAuthSecrets
  const env = starterEnvironment()
  delete env.BETTER_AUTH_SECRETS
  const options = { env }

  await runProcess(
    'convex-env',
    ['exec', 'better-convex-nuxt-convex', 'env', 'set', 'SITE_URL', rootUrl],
    30_000,
    options,
  )
  await runProcess(
    'convex-env',
    ['exec', 'better-convex-nuxt-convex', 'env', 'set', 'BETTER_AUTH_SECRETS'],
    30_000,
    { ...options, input: authSecrets },
  )
}

async function submitNamedForm(page, placeholder, value) {
  const form = page
    .locator('form')
    .filter({ has: page.getByPlaceholder(placeholder) })
    .last()
  const input = form.getByPlaceholder(placeholder)
  const submit = form.getByRole('button', { name: 'Create' })
  await input.fill(value)
  await waitForEnabled(submit, `${placeholder} create button`)
  await input.press('Enter')
}

async function submitButtonForm(page, buttonName, inputPlaceholder, value) {
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: buttonName }) })
    .filter({ has: page.getByPlaceholder(inputPlaceholder) })
  const input = form.getByPlaceholder(inputPlaceholder)
  const submit = form.getByRole('button', { name: buttonName })
  await input.fill(value)
  await waitForEnabled(submit, `${buttonName} button`)
  await submit.click()
}

async function waitForEnabled(locator, label, timeoutMs = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) return
    await delay(100)
  }

  throw new Error(`${label} was not enabled within ${timeoutMs}ms`)
}

async function submitSignUpForm(page, args) {
  const form = page.locator('form.auth-form')
  const submit = form.getByRole('button', { name: 'Create account' })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await form.waitFor({ state: 'visible', timeout: 20_000 })
    await form.getByPlaceholder('Your name').fill(args.name)
    await form.getByPlaceholder('you@example.com').fill(args.email)
    await form.getByPlaceholder('Min 15 characters').fill(args.password)

    try {
      await waitForEnabled(submit, 'Create account button', 5_000)
      await submit.click()
      return
    } catch (error) {
      if (attempt === 2) throw error
      await delay(500)
    }
  }
}

async function submitSignInForm(page, args) {
  const form = page.locator('form.auth-form')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await form.getByPlaceholder('Your name').waitFor({ state: 'detached', timeout: 10_000 })
  await form.getByPlaceholder('you@example.com').fill(args.email)
  await form.getByPlaceholder('Min 15 characters').fill(args.password)
  const submit = form.getByRole('button', { name: 'Sign in' })
  await waitForEnabled(submit, 'Sign in button')
  await submit.click()
}

async function visibleProjectRow(page, name, failures, options = {}) {
  const projects = page.getByLabel('Projects')
  const row = projects.locator('li').filter({ hasText: name }).first()

  try {
    await row.waitFor({ state: 'visible', timeout: 20_000 })
  } catch (error) {
    const debug = await projects
      .textContent({ timeout: 1_000 })
      .catch(async () => await page.locator('body').textContent({ timeout: 1_000 }))
      .catch(() => 'Unable to read page text')
    const formDebug = await page.evaluate(() =>
      Array.from(document.querySelectorAll('form')).map((form) => ({
        text: form.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        inputs: Array.from(form.querySelectorAll('input')).map((input) => ({
          placeholder: input.getAttribute('placeholder'),
          value: input.value,
          disabled: input.disabled,
        })),
        buttons: Array.from(form.querySelectorAll('button')).map((button) => ({
          text: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          disabled: button.disabled,
          type: button.getAttribute('type'),
        })),
        errors: Array.from(form.querySelectorAll('.form-error, .auth-error')).map(
          (node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        ),
      })),
    )
    throw new Error(
      [
        `Project row "${name}" was not visible.`,
        `URL: ${page.url()}`,
        `Visible project/page text:\n${debug}`,
        `Form debug:\n${JSON.stringify(formDebug, null, 2)}`,
        options.teamName ? `Expected selected team: ${options.teamName}` : null,
        failures.length ? `Captured failures:\n${failures.join('\n')}` : null,
        error instanceof Error ? `Original wait error:\n${error.message}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      { cause: error },
    )
  }

  return row
}

async function waitForListRow(page, sectionHeading, text) {
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: sectionHeading }) })
    .first()
  const row = section.locator('li').filter({ hasText: text }).first()
  await row.waitFor({ state: 'visible', timeout: 20_000 })
  return row
}

async function waitForDevServerInvitationLink(email, timeoutMs = 20_000) {
  const started = Date.now()
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `Invitation link ${escapedEmail}:\\s+(https?:\\/\\/[^\\s']+\\/invitations\\/[^\\s']+)`,
  )

  while (Date.now() - started < timeoutMs) {
    const match = getDevServerOutput().match(pattern)
    if (match?.[1]) return match[1]
    await delay(100)
  }

  throw new Error(`Invitation link for ${email} was not logged within ${timeoutMs}ms`)
}

async function waitForDevServerVerificationLink(email, timeoutMs = 20_000) {
  const started = Date.now()
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `Verification link ${escapedEmail}:\\s+(https?:\\/\\/[^\\s']+\\/api\\/auth\\/verify-email\\?[^\\s']+)`,
  )

  while (Date.now() - started < timeoutMs) {
    const match = getDevServerOutput().match(pattern)
    if (match?.[1]) return match[1]
    await delay(100)
  }

  throw new Error(`Verification link for ${email} was not logged within ${timeoutMs}ms`)
}

function isAllowedAuthToken401Console(message, allowAuthToken401) {
  if (!allowAuthToken401) return false
  if (
    !message.text().includes('Failed to load resource: the server responded with a status of 401')
  ) {
    return false
  }

  const locationUrl = message.location().url
  if (!locationUrl) return false

  try {
    return new URL(locationUrl).pathname === '/api/auth/convex/token'
  } catch {
    return false
  }
}

function trackPageFailures(page, failures, label, options = {}) {
  page.on('pageerror', (error) => {
    failures.push(`${label} page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (isAllowedAuthToken401Console(message, options.allowAuthToken401)) return
    if (['error', 'warning'].includes(message.type())) {
      failures.push(`${label} console ${message.type()}: ${message.text()}`)
    }
  })
  page.on('response', (response) => {
    if (
      response.status() === 401 &&
      new URL(response.url()).pathname === '/api/auth/convex/token' &&
      options.allowAuthToken401
    ) {
      return
    }
    if (response.status() >= 400) {
      failures.push(`${label} ${response.status()} ${response.url()}`)
    }
  })
}

async function assertSignedOutInvitationPrompt(browser, invitationUrl, failures) {
  const signedOutContext = await browser.newContext(getBrowserContextOptions())
  const signedOutPage = await signedOutContext.newPage()

  trackPageFailures(signedOutPage, failures, 'invitation', { allowAuthToken401: true })

  try {
    await signedOutPage.goto(invitationUrl, { waitUntil: 'domcontentloaded' })
    await signedOutPage
      .getByRole('heading', { name: 'Join an organization' })
      .waitFor({ timeout: 20_000 })
    await signedOutPage
      .getByText('Sign in or create an account with the invited email address to continue.')
      .waitFor({ state: 'visible', timeout: 20_000 })
    await signedOutPage.locator('form.auth-form').waitFor({ state: 'visible', timeout: 20_000 })
  } finally {
    await signedOutContext.close()
  }
}

async function completeInvitation(browser, args, failures) {
  const inviteeContext = await browser.newContext(getBrowserContextOptions())
  const inviteePage = await inviteeContext.newPage()
  const inviteeFailureOptions = { allowAuthToken401: true }
  trackPageFailures(inviteePage, failures, `${args.action}-invite`, inviteeFailureOptions)

  try {
    await inviteePage.goto(args.invitationUrl, { waitUntil: 'domcontentloaded' })
    await inviteePage
      .getByRole('heading', { name: 'Join an organization' })
      .waitFor({ timeout: 20_000 })
    await submitSignUpForm(inviteePage, {
      name: args.name,
      email: args.email,
      password: args.password,
    })
    await inviteePage
      .getByRole('heading', { name: 'Verify your email first' })
      .waitFor({ timeout: 30_000 })

    const verificationUrl = await waitForDevServerVerificationLink(args.email)
    await inviteePage.goto(verificationUrl, { waitUntil: 'domcontentloaded' })
    await inviteePage
      .getByRole('heading', { name: 'Join an organization' })
      .waitFor({ timeout: 30_000 })
    await inviteePage.getByText(args.email).waitFor({ state: 'visible', timeout: 30_000 })
    inviteeFailureOptions.allowAuthToken401 = false
    await inviteePage.getByText(`Team: ${args.teamName}`).waitFor({
      state: 'visible',
      timeout: 30_000,
    })

    if (args.action === 'accept') {
      await inviteePage.getByRole('button', { name: 'Accept invitation' }).click()
      await inviteePage
        .getByRole('heading', { name: 'Projects' })
        .waitFor({ state: 'visible', timeout: 30_000 })
      return
    }

    await inviteePage.getByRole('button', { name: 'Reject invitation' }).click()
    await inviteePage.getByText('Invitation rejected.').waitFor({
      state: 'visible',
      timeout: 30_000,
    })
  } catch (error) {
    const debug = await inviteePage
      .evaluate(() => ({
        url: location.href,
        text: document.body.textContent?.replace(/\s+/g, ' ').slice(0, 2_000) ?? '',
      }))
      .catch(() => ({ url: inviteePage.url(), text: 'Unable to read invitee page text' }))
    throw new Error(
      [
        `${args.action} invitation flow failed.`,
        `Debug:\n${JSON.stringify(debug, null, 2)}`,
        failures.length ? `Captured failures:\n${failures.join('\n')}` : null,
        error instanceof Error ? `Original wait error:\n${error.message}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      { cause: error },
    )
  } finally {
    await inviteeContext.close()
  }
}

async function waitForSelectValue(locator, value, timeoutMs = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if ((await locator.inputValue().catch(() => null)) === value) return
    await delay(100)
  }

  throw new Error(`Select value did not become "${value}" within ${timeoutMs}ms`)
}

async function selectTeam(page, name) {
  const teamSelect = page.locator('label').filter({ hasText: 'Team' }).locator('select')
  await teamSelect.waitFor({ state: 'visible', timeout: 20_000 })

  let optionValue = null
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    optionValue = await teamSelect.evaluate((select, expectedName) => {
      const option = Array.from(select.options).find(
        (option) => option.textContent?.trim() === expectedName,
      )
      return option?.value ?? null
    }, name)
    if (optionValue) break
    await delay(100)
  }

  if (!optionValue) {
    const options = await teamSelect.evaluate((select) =>
      Array.from(select.options).map((option) => option.textContent?.trim() ?? ''),
    )
    throw new Error(`Team option "${name}" was not found. Options: ${options.join(', ')}`)
  }

  await teamSelect.selectOption(optionValue)
  await waitForSelectValue(teamSelect, optionValue)

  const teamRenameInput = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Rename team' }) })
    .getByPlaceholder('Team name')
  await teamRenameInput.waitFor({ state: 'visible', timeout: 20_000 })

  const selectedStarted = Date.now()
  while (Date.now() - selectedStarted < 20_000) {
    if ((await teamRenameInput.inputValue().catch(() => null)) === name) return
    await delay(100)
  }

  throw new Error(
    `Selected team form did not update to "${name}". Current value: ${await teamRenameInput
      .inputValue()
      .catch(() => 'unreadable')}`,
  )
}

async function waitForSignedOutPanel(page, failures) {
  try {
    await page.locator('form.auth-form').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByText('Signed out').waitFor({ state: 'visible', timeout: 30_000 })
  } catch (error) {
    const debug = await page
      .evaluate(() => ({
        url: location.href,
        text: document.body.textContent?.replace(/\s+/g, ' ').slice(0, 2_000) ?? '',
        auth: {
          token: window.__NUXT__?.state?.['$sconvex:token'] ?? null,
          user: window.__NUXT__?.state?.['$sconvex:user'] ?? null,
          pending: window.__NUXT__?.state?.['$sconvex:pending'] ?? null,
          authError: window.__NUXT__?.state?.['$sconvex:authError'] ?? null,
        },
      }))
      .catch(() => ({ url: page.url(), text: 'Unable to read page text', auth: null }))
    throw new Error(
      [
        'Signed-out auth panel was not visible after sign-out.',
        `Debug:\n${JSON.stringify(debug, null, 2)}`,
        failures.length ? `Captured failures:\n${failures.join('\n')}` : null,
        error instanceof Error ? `Original wait error:\n${error.message}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      { cause: error },
    )
  }
}

async function runBrowserHappyPath() {
  const browser = await chromium.launch()
  const context = await browser.newContext(getBrowserContextOptions())
  const page = await context.newPage()
  const failures = []
  let allowAuthToken401 = true

  page.on('pageerror', (error) => {
    failures.push(`page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (isAllowedAuthToken401Console(message, allowAuthToken401)) return
    if (['error', 'warning'].includes(message.type())) {
      failures.push(`console ${message.type()}: ${message.text()}`)
    }
  })
  page.on('response', (response) => {
    if (
      response.status() === 401 &&
      new URL(response.url()).pathname === '/api/auth/convex/token' &&
      allowAuthToken401
    ) {
      return
    }
    if (response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`)
    }
  })

  const stamp = Date.now()
  const name = `Browser User ${stamp}`
  const email = `starter-browser-${stamp}@example.com`
  const password = `Starter-${stamp}!`
  const organizationName = `Browser Org ${stamp}`
  const renamedOrganizationName = `Browser Org Renamed ${stamp}`
  const teamName = `Product Team ${stamp}`
  const renamedTeamName = `Renamed Team ${stamp}`
  const projectName = `Launch Plan ${stamp}`
  const renamedProjectName = `Launch Plan Renamed ${stamp}`
  const inviteEmail = `invite-${stamp}@example.com`
  const acceptedInviteEmail = `accepted-${stamp}@example.com`
  const acceptedInviteName = `Accepted Invite ${stamp}`
  const acceptedInvitePassword = `Accepted-${stamp}!`
  const rejectedInviteEmail = `rejected-${stamp}@example.com`
  const rejectedInviteName = `Rejected Invite ${stamp}`
  const rejectedInvitePassword = `Rejected-${stamp}!`

  try {
    await page.goto(rootUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Organizations' }).waitFor({ timeout: 20_000 })
    await submitSignUpForm(page, { name, email, password })

    await page.getByPlaceholder('Organization name').waitFor({ state: 'visible', timeout: 30_000 })
    await submitNamedForm(page, 'Organization name', organizationName)

    const orgLink = page.getByRole('link', { name: new RegExp(organizationName) })
    await orgLink.waitFor({ state: 'visible', timeout: 30_000 })
    await orgLink.click()

    await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 20_000 })
    allowAuthToken401 = false
    await page.getByRole('button', { name: 'Create team' }).waitFor({ timeout: 20_000 })
    await submitNamedForm(page, 'Team name', teamName)
    await selectTeam(page, teamName)

    await submitButtonForm(
      page,
      'Rename organization',
      'Organization name',
      renamedOrganizationName,
    )
    await page.locator('.header p').filter({ hasText: renamedOrganizationName }).waitFor({
      state: 'visible',
      timeout: 20_000,
    })

    await submitButtonForm(page, 'Rename team', 'Team name', renamedTeamName)
    await selectTeam(page, renamedTeamName)

    await waitForListRow(page, 'Members', email)

    await submitButtonForm(page, 'Invite', 'Invite by email', inviteEmail)
    const invitationRow = await waitForListRow(page, 'Invitations', inviteEmail)
    const invitationUrl = await waitForDevServerInvitationLink(inviteEmail)
    await assertSignedOutInvitationPrompt(browser, invitationUrl, failures)
    await invitationRow.getByRole('button', { name: 'Cancel' }).click()
    await invitationRow.waitFor({ state: 'detached', timeout: 20_000 })

    await submitButtonForm(page, 'Invite', 'Invite by email', acceptedInviteEmail)
    const acceptedInvitationRow = await waitForListRow(page, 'Invitations', acceptedInviteEmail)
    const acceptedInvitationUrl = await waitForDevServerInvitationLink(acceptedInviteEmail)
    await completeInvitation(
      browser,
      {
        action: 'accept',
        invitationUrl: acceptedInvitationUrl,
        name: acceptedInviteName,
        email: acceptedInviteEmail,
        password: acceptedInvitePassword,
        teamName: renamedTeamName,
      },
      failures,
    )
    await acceptedInvitationRow.waitFor({ state: 'detached', timeout: 20_000 })

    await submitButtonForm(page, 'Invite', 'Invite by email', rejectedInviteEmail)
    const rejectedInvitationRow = await waitForListRow(page, 'Invitations', rejectedInviteEmail)
    const rejectedInvitationUrl = await waitForDevServerInvitationLink(rejectedInviteEmail)
    await completeInvitation(
      browser,
      {
        action: 'reject',
        invitationUrl: rejectedInvitationUrl,
        name: rejectedInviteName,
        email: rejectedInviteEmail,
        password: rejectedInvitePassword,
        teamName: renamedTeamName,
      },
      failures,
    )
    await rejectedInvitationRow.waitFor({ state: 'detached', timeout: 20_000 })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 20_000 })
    await selectTeam(page, renamedTeamName)
    let acceptedMemberRow = await waitForListRow(page, 'Members', acceptedInviteEmail)
    const acceptedMemberRoleSelect = acceptedMemberRow.locator('select')
    await acceptedMemberRoleSelect.selectOption('viewer')
    await waitForSelectValue(acceptedMemberRoleSelect, 'viewer')
    await acceptedMemberRow.getByRole('button', { name: 'Remove from team' }).click()
    await acceptedMemberRow
      .getByRole('button', { name: 'Add to team' })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await acceptedMemberRow.getByRole('button', { name: 'Add to team' }).click()
    await acceptedMemberRow
      .getByRole('button', { name: 'Remove from team' })
      .waitFor({ state: 'visible', timeout: 20_000 })
    await acceptedMemberRow.getByRole('button', { name: 'Remove', exact: true }).click()
    await acceptedMemberRow.waitFor({ state: 'detached', timeout: 20_000 })

    await page.getByPlaceholder('Project name').waitFor({ state: 'visible', timeout: 30_000 })
    await submitNamedForm(page, 'Project name', projectName)

    let row = await visibleProjectRow(page, projectName, failures, { teamName: renamedTeamName })
    await row.getByRole('button', { name: 'Rename' }).click()
    const renameForm = page
      .getByLabel('Projects')
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Save' }) })
    await renameForm.locator('input').fill(renamedProjectName)
    await renameForm.getByRole('button', { name: 'Save' }).click()

    row = await visibleProjectRow(page, renamedProjectName, failures, { teamName: renamedTeamName })
    await row.getByRole('button', { name: 'Delete' }).click()
    await row.waitFor({ state: 'detached', timeout: 20_000 })

    await page.getByRole('button', { name: 'Deleted' }).click()
    row = await visibleProjectRow(page, renamedProjectName, failures, { teamName: renamedTeamName })
    await row.getByRole('button', { name: 'Restore' }).click()
    await row.waitFor({ state: 'detached', timeout: 20_000 })

    await page.getByRole('button', { name: 'Active' }).click()
    await visibleProjectRow(page, renamedProjectName, failures, { teamName: renamedTeamName })
    await waitForListRow(page, 'Team activity', 'Restored')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 20_000 })
    await selectTeam(page, renamedTeamName)
    await visibleProjectRow(page, renamedProjectName, failures, { teamName: renamedTeamName })

    await page.goto(rootUrl, { waitUntil: 'domcontentloaded' })
    console.log('[browser] signing out owner')
    allowAuthToken401 = true
    await page.getByRole('button', { name: 'Sign out' }).click()
    await waitForSignedOutPanel(page, failures)
    console.log('[browser] owner signed out')
    console.log('[browser] signing in owner')
    await submitSignInForm(page, { email, password })
    await page.getByRole('link', { name: new RegExp(renamedOrganizationName) }).waitFor({
      state: 'visible',
      timeout: 30_000,
    })
    allowAuthToken401 = false
    console.log('[browser] owner signed in')
    console.log('[browser] signing out owner again')
    allowAuthToken401 = true
    await page.getByRole('button', { name: 'Sign out' }).click()
    await waitForSignedOutPanel(page, failures)
    console.log('[browser] owner signed out again')

    if (failures.length) {
      throw new Error(`Browser smoke saw unexpected failures:\n${failures.join('\n')}`)
    }

    console.log(`Browser happy path passed (${browserViewport})`)
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  await assertPortFree(nuxtPort, 'Nuxt')
  await assertPortFree(convexCloudPort, 'Convex cloud')
  await assertPortFree(convexSitePort, 'Convex site')

  try {
    await startProcess(
      'convex',
      [
        'exec',
        'better-convex-nuxt-convex',
        'dev',
        '--anonymous',
        '--local-cloud-port',
        String(convexCloudPort),
        '--local-site-port',
        String(convexSitePort),
      ],
      /Convex functions ready/,
      90_000,
    )
    await configureConvexAuthEnv()
    await startProcess(
      'nuxt',
      ['exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', String(nuxtPort)],
      /Local:\s+http:\/\/127\.0\.0\.1:/,
      60_000,
    )
    await delay(3_000)
    await runBrowserHappyPath()
  } finally {
    await stopProcesses()
  }
}

main().catch(async (error) => {
  await stopProcesses()
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
