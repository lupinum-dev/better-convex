#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

import {
  createSecretSentinels,
  replaceSecretSentinel,
  scanSecretSentinelSurfaces,
  sentinelEncodings,
} from './auth-secret-sentinels.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const convexCli = path.join(repoRoot, 'node_modules/convex/bin/main.js')
const oauthRunner = path.join(repoRoot, 'scripts/run-oauth-code-concurrency.mjs')
const CALLBACK = 'http://localhost:6274/oauth/callback'
const SCOPE = 'mcp:read mcp:write'
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const MAX_EXPORT_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_EXPORT_FILE_BYTES = 32 * 1024 * 1024
const MAX_EXPORT_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_EXPORT_FILES = 2_000
const MAX_EXPORT_PATH_BYTES = 512
const REQUEST_TIMEOUT_MS = 60_000

const REQUIRED_COMPONENT_TABLES = Object.freeze([
  'account',
  'jwks',
  'oauthAccessToken',
  'oauthClient',
  'verification',
])
const REQUIRED_COMPONENT_ROWS = Object.freeze({
  account: 2,
  jwks: 1,
  // The signed JWT access token is deliberately not persisted. Requiring the
  // canonical empty table plus scanning the actual issued JWT proves absence.
  oauthAccessToken: 0,
  oauthClient: 3,
  verification: 1,
})

function assert(condition, code) {
  if (!condition) throw new Error(code)
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function safeFailureMessage(error, sentinels) {
  let message = error instanceof Error ? error.message : String(error)
  for (const value of Object.values(sentinels)) {
    for (const encoding of sentinelEncodings(value)) {
      message = message.replaceAll(encoding.value, '[REDACTED]')
    }
  }
  return message.replace(/[\r\n]+/gu, ' ').slice(0, 1_000)
}

function cleanChildEnvironment() {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith('CONVEX_')) delete env[name]
  }
  return env
}

async function runCaptured(sentinels, label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? cleanChildEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = []
  const stderr = []
  let outputBytes = 0
  let overflow = false
  const capture = (target) => (chunk) => {
    outputBytes += chunk.length
    if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
      overflow = true
      child.kill('SIGKILL')
      return
    }
    target.push(Buffer.from(chunk))
  }
  child.stdout.on('data', capture(stdout))
  child.stderr.on('data', capture(stderr))
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const output = {
    stderr: Buffer.concat(stderr),
    stdout: Buffer.concat(stdout),
  }
  scanSecretSentinelSurfaces(sentinels, [
    { category: 'console', location: `console.command.${label}.stdout`, value: output.stdout },
    { category: 'console', location: `console.command.${label}.stderr`, value: output.stderr },
  ])
  assert(!overflow, 'AUTH_EXPORT_COMMAND_OUTPUT_BOUND_EXCEEDED')
  assert(result.signal === null, 'AUTH_EXPORT_COMMAND_SIGNALLED')
  if (result.code !== 0) {
    const diagnostic = output.stderr
      .toString('utf8')
      .replaceAll(String.fromCharCode(27), '')
      .replace(/[\r\n]+/gu, ' ')
      .slice(-800)
    throw new Error(`AUTH_EXPORT_COMMAND_FAILED:${label}:${diagnostic || 'no-stderr'}`)
  }
  return output.stdout.toString('utf8')
}

export function validateExportArchiveEntries(entries) {
  assert(Array.isArray(entries) && entries.length > 0, 'AUTH_EXPORT_ARCHIVE_EMPTY')
  assert(entries.length <= MAX_EXPORT_FILES, 'AUTH_EXPORT_FILE_COUNT_BOUND_EXCEEDED')
  const files = []
  for (const entry of entries) {
    assert(typeof entry === 'string', 'AUTH_EXPORT_ARCHIVE_PATH_INVALID')
    assert(
      entry.length > 0 && Buffer.byteLength(entry) <= MAX_EXPORT_PATH_BYTES,
      'AUTH_EXPORT_ARCHIVE_PATH_INVALID',
    )
    assert(!entry.includes('\0') && !entry.includes('\\'), 'AUTH_EXPORT_ARCHIVE_PATH_INVALID')
    const file = entry.endsWith('/') ? entry.slice(0, -1) : entry
    const normalized = path.posix.normalize(file)
    assert(
      file.length > 0 &&
        !path.posix.isAbsolute(file) &&
        normalized === file &&
        file !== '..' &&
        !file.startsWith('../') &&
        !file.includes('/../'),
      'AUTH_EXPORT_ARCHIVE_PATH_INVALID',
    )
    if (!entry.endsWith('/')) files.push(file)
  }
  assert(new Set(entries).size === entries.length, 'AUTH_EXPORT_ARCHIVE_DUPLICATE_PATH')
  return Object.freeze(files)
}

export function parseExportArchiveTotals(output, expectedEntries) {
  assert(typeof output === 'string', 'AUTH_EXPORT_ARCHIVE_TOTALS_INVALID')
  const match = output.trim().match(/^(\d+) files?, (\d+) bytes uncompressed,/u)
  assert(match, 'AUTH_EXPORT_ARCHIVE_TOTALS_INVALID')
  const entries = Number(match[1])
  const bytes = Number(match[2])
  assert(
    Number.isSafeInteger(entries) && entries === expectedEntries,
    'AUTH_EXPORT_ARCHIVE_ENTRY_COUNT_MISMATCH',
  )
  assert(
    Number.isSafeInteger(bytes) && bytes <= MAX_EXPORT_TOTAL_BYTES,
    'AUTH_EXPORT_TOTAL_SIZE_BOUND_EXCEEDED',
  )
  return Object.freeze({ bytes, entries })
}

export function assertComponentExportCoverage(files) {
  const covered = new Set()
  for (const file of files) {
    const parts = file.split('/')
    for (const table of REQUIRED_COMPONENT_TABLES) {
      if (parts.includes(table) && parts.at(-1) === 'documents.jsonl') covered.add(table)
    }
  }
  const missing = REQUIRED_COMPONENT_TABLES.filter((table) => !covered.has(table))
  assert(missing.length === 0, `AUTH_EXPORT_COMPONENT_TABLE_MISSING:${missing.join(',')}`)
  return Object.freeze([...covered].sort())
}

export function assertComponentExportRows(files) {
  const counts = Object.fromEntries(REQUIRED_COMPONENT_TABLES.map((table) => [table, 0]))
  for (const file of files) {
    if (!file.path.endsWith('/documents.jsonl')) continue
    const parts = file.path.split('/')
    const table = REQUIRED_COMPONENT_TABLES.find((candidate) => parts.includes(candidate))
    if (!table) continue
    const lines = file.value.toString('utf8').split(/\r?\n/u).filter(Boolean)
    for (const line of lines) {
      try {
        const value = JSON.parse(line)
        assert(isRecord(value), 'AUTH_EXPORT_COMPONENT_ROW_INVALID')
      } catch {
        throw new Error('AUTH_EXPORT_COMPONENT_ROW_INVALID')
      }
    }
    counts[table] += lines.length
  }
  for (const [table, minimum] of Object.entries(REQUIRED_COMPONENT_ROWS)) {
    assert(counts[table] >= minimum, `AUTH_EXPORT_COMPONENT_ROW_MISSING:${table}`)
  }
  return Object.freeze({ ...counts })
}

async function walkExportFiles(root) {
  const files = []
  let totalBytes = 0

  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name)
      const metadata = await lstat(absolute)
      assert(!metadata.isSymbolicLink(), 'AUTH_EXPORT_SYMBOLIC_LINK_FORBIDDEN')
      if (metadata.isDirectory()) {
        await walk(absolute)
        continue
      }
      assert(metadata.isFile(), 'AUTH_EXPORT_SPECIAL_FILE_FORBIDDEN')
      assert(metadata.size <= MAX_EXPORT_FILE_BYTES, 'AUTH_EXPORT_FILE_SIZE_BOUND_EXCEEDED')
      totalBytes += metadata.size
      assert(totalBytes <= MAX_EXPORT_TOTAL_BYTES, 'AUTH_EXPORT_TOTAL_SIZE_BOUND_EXCEEDED')
      files.push(absolute)
      assert(files.length <= MAX_EXPORT_FILES, 'AUTH_EXPORT_FILE_COUNT_BOUND_EXCEEDED')
    }
  }

  await walk(root)
  return Object.freeze({ files, totalBytes })
}

export function assertOAuthBrowserStorageCoverage(source) {
  assert(typeof source === 'string', 'AUTH_BROWSER_STORAGE_SOURCE_INVALID')
  const start = source.indexOf('async function assertNoBrowserCredentialStorage')
  const end = source.indexOf('async function runAuthorizationCodeRace', start)
  assert(start >= 0 && end > start, 'AUTH_BROWSER_STORAGE_ASSERTION_MISSING')
  const body = source.slice(start, end)
  for (const marker of [
    'Object.entries(localStorage)',
    'Object.entries(sessionStorage)',
    'await caches.keys()',
    'await indexedDB.databases()',
    'applicationStorage.cacheNames.length === 0',
    'applicationStorage.indexedDbNames.length === 0',
    'await context.storageState()',
    'state.cookies.every',
    'containsCompactJwt(applicationStorage)',
    'containsCompactJwt(state)',
  ]) {
    assert(body.includes(marker), 'AUTH_BROWSER_STORAGE_SURFACE_MISSING')
  }
  assert(
    source.indexOf('await assertNoBrowserCredentialStorage(', end) > end,
    'AUTH_BROWSER_STORAGE_ASSERTION_UNUSED',
  )
  return Object.freeze({
    cacheStorage: 'must-be-empty',
    cookies: 'scanned',
    indexedDb: 'must-be-empty',
    localStorage: 'scanned',
    sessionStorage: 'scanned',
  })
}

export async function runFailClosedCleanup(tasks) {
  let failed = false
  for (const task of tasks) {
    try {
      await task()
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error('AUTH_EXPORT_CLEANUP_FAILED')
}

function fixtureActionSource(runId) {
  return `
import { symmetricEncrypt } from 'better-auth/crypto'
import { setTokenUtil } from 'better-auth/oauth2'
import { v } from 'convex/values'

import { action } from './_generated/server'
import { createAuth } from './auth'

const RUN_ID = ${JSON.stringify(runId)}

async function sentinel(id: string): Promise<string> {
  const input = new TextEncoder().encode(\`better-convex-nuxt\\0\${RUN_ID}\\0\${id}\`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return \`BCN_SENTINEL_\${id.replaceAll('-', '_').toUpperCase()}_\${hex}\`
}

export const seedEncryptedCredentials = action({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (args.runId !== RUN_ID) throw new Error('AUTH_EXPORT_SENTINEL_PROOF_INVALID')
    const auth = await createAuth(ctx)
    const context = await auth.$context
    const users = await context.adapter.findMany({ model: 'user', limit: 2 })
    if (users.length !== 1 || typeof users[0]?.id !== 'string') {
      throw new Error('AUTH_EXPORT_SENTINEL_USER_INVALID')
    }
    const userId = users[0].id
    const now = new Date()
    await context.adapter.create({
      model: 'account',
      data: {
        id: crypto.randomUUID(),
        issuer: 'https://auth-export-sentinel.example.test',
        accountId: 'auth-export-sentinel-provider-account',
        providerId: 'auth-export-sentinel-provider',
        userId,
        accessToken: await setTokenUtil(await sentinel('social-access-token'), context),
        refreshToken: await setTokenUtil(await sentinel('social-refresh-token'), context),
        idToken: await sentinel('social-id-token'),
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password: null,
        createdAt: now,
        updatedAt: now,
      },
    })
    const key = await context.adapter.findOne({ model: 'jwks', where: [] })
    if (!key || typeof key.id !== 'string') throw new Error('AUTH_EXPORT_SENTINEL_JWK_MISSING')
    const privateKey = JSON.stringify(
      await symmetricEncrypt({
        data: JSON.stringify({ d: await sentinel('private-jwk-member'), kty: 'RSA' }),
        key: context.secretConfig,
      }),
    )
    const updated = await context.adapter.update({
      model: 'jwks',
      where: [{ field: 'id', value: key.id }],
      update: { privateKey },
    })
    if (!updated) throw new Error('AUTH_EXPORT_SENTINEL_JWK_UPDATE_FAILED')
    return 'AUTH_EXPORT_SENTINEL_SEEDED'
  },
})
`
}

async function installFixtureAction(cwd, runId) {
  await Promise.all([
    writeFile(path.join(cwd, 'convex/authExportSentinelFixture.ts'), fixtureActionSource(runId), {
      encoding: 'utf8',
      mode: 0o600,
    }),
    writeFile(
      path.join(cwd, 'app/pages/release-auth-lifecycle.vue'),
      `<script setup lang="ts">
const { client, pending, status } = useConvexAuth()
const hydrated = ref(false)
onMounted(() => { hydrated.value = true })
async function reconcileSession() {
  if (!client) throw new Error('Integrated auth client is not ready')
  await client.getSession()
}
</script>

<template>
  <main>
    <p data-testid="auth-status">{{ status }}</p>
    <p data-testid="auth-pending">{{ pending }}</p>
    <p data-testid="hydrated">{{ hydrated ? 'ready' : 'server' }}</p>
    <button data-testid="refresh" type="button" @click="reconcileSession()">Refresh</button>
  </main>
</template>
`,
      { encoding: 'utf8', mode: 0o600 },
    ),
    writeFile(
      path.join(cwd, 'app/pages/release-auth-protected.vue'),
      `<script setup lang="ts">
definePageMeta({ convexAuth: true })
</script>

<template><p data-testid="protected-content">Protected release evidence</p></template>
`,
      { encoding: 'utf8', mode: 0o600 },
    ),
  ])
}

async function signInFixture(context, fixture) {
  const response = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    data: { email: fixture.email, password: fixture.password },
    headers: { origin: fixture.origin },
  })
  assert(response.ok(), 'AUTH_EXPORT_FIXTURE_SIGN_IN_FAILED')
}

async function assertAnonymousBootstrap(context, fixture) {
  const response = await context.request.get(`${fixture.origin}/api/auth/convex/token`, {
    headers: { origin: fixture.origin },
  })
  assert(response.status() === 200, 'AUTH_EXPORT_ANONYMOUS_BOOTSTRAP_FAILED')
  const body = await response.json()
  assert(
    isRecord(body) && Object.keys(body).join(',') === 'token' && body.token === null,
    'AUTH_EXPORT_ANONYMOUS_BOOTSTRAP_INVALID',
  )
}

async function waitForFixtureText(page, testId, predicate, code) {
  const deadline = Date.now() + 30_000
  let value = ''
  while (Date.now() < deadline) {
    value =
      (
        await page
          .getByTestId(testId)
          .textContent()
          .catch(() => '')
      )?.trim() ?? ''
    if (predicate(value)) return value
    await page.waitForTimeout(50)
  }
  throw new Error(`${code}:${value.slice(0, 64) || 'missing'}`)
}

async function assertAuthenticatedLifecycle(page, context, fixture) {
  const ssr = await context.request.get(`${fixture.origin}/release-auth-lifecycle`)
  assert(ssr.status() === 200, 'AUTH_EXPORT_AUTHENTICATED_SSR_FAILED')
  assert(
    ssr.headers()['cache-control'] === 'private, no-store',
    'AUTH_EXPORT_AUTHENTICATED_SSR_CACHE_INVALID',
  )
  const html = await ssr.text()
  assert(
    html.includes('data-testid="auth-status"') && html.includes('authenticated'),
    'AUTH_EXPORT_AUTHENTICATED_SSR_IDENTITY_MISSING',
  )

  await page.goto(`${fixture.origin}/release-auth-lifecycle`, { waitUntil: 'domcontentloaded' })
  await waitForFixtureText(page, 'hydrated', (value) => value === 'ready', 'AUTH_EXPORT_HYDRATION')
  assert(
    (await page.getByTestId('auth-status').textContent())?.trim() === 'authenticated',
    'AUTH_EXPORT_AUTHENTICATED_HYDRATION_FAILED',
  )
  await page.getByTestId('refresh').click()
  await waitForFixtureText(
    page,
    'auth-pending',
    (value) => value === 'false',
    'AUTH_EXPORT_REFRESH_SETTLEMENT',
  )
  assert(
    (await page.getByTestId('auth-status').textContent())?.trim() === 'authenticated',
    'AUTH_EXPORT_AUTHENTICATED_REFRESH_FAILED',
  )

  await page.goto(`${fixture.origin}/release-auth-protected`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('protected-content').waitFor()
  assert(new URL(page.url()).pathname === '/release-auth-protected', 'AUTH_EXPORT_GUARD_FAILED')
}

async function revokeCurrentSession(browser, page, context, fixture) {
  const sessionResponse = await context.request.get(`${fixture.origin}/api/auth/get-session`)
  assert(sessionResponse.ok(), 'AUTH_EXPORT_GET_SESSION_FAILED')
  const current = await sessionResponse.json()
  assert(
    isRecord(current) &&
      isRecord(current.session) &&
      typeof current.session.token === 'string' &&
      current.session.token.length > 0,
    'AUTH_EXPORT_SESSION_TOKEN_INVALID',
  )

  const administrator = await browser.newContext()
  try {
    await signInFixture(administrator, fixture)
    const revoked = await administrator.request.post(`${fixture.origin}/api/auth/revoke-session`, {
      data: { token: current.session.token },
      headers: { origin: fixture.origin },
    })
    assert(revoked.ok(), 'AUTH_EXPORT_SESSION_REVOCATION_FAILED')
  } finally {
    await administrator.close()
  }

  const rejected = await context.request.get(`${fixture.origin}/api/auth/convex/token`)
  assert(rejected.status() === 401, 'AUTH_EXPORT_REVOKED_SESSION_ACCEPTED')
  await page.goto(`${fixture.origin}/release-auth-lifecycle`, { waitUntil: 'domcontentloaded' })
  await waitForFixtureText(
    page,
    'auth-status',
    (value) => value !== '' && value !== 'authenticated',
    'AUTH_EXPORT_REVOKED_SESSION_STATE',
  )
  await page.goto(`${fixture.origin}/release-auth-protected?reason=revoked`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForURL((url) => url.pathname === '/auth/signin')
  assert(
    new URL(page.url()).searchParams.get('redirect') === '/release-auth-protected?reason=revoked',
    'AUTH_EXPORT_REVOKED_GUARD_RETURN_INVALID',
  )
}

async function assertSignOutLifecycle(page, context, fixture) {
  const signedOut = await context.request.post(`${fixture.origin}/api/auth/sign-out`, {
    data: {},
    headers: { origin: fixture.origin },
  })
  assert(signedOut.ok(), `AUTH_EXPORT_SIGN_OUT_REQUEST_FAILED:${signedOut.status()}`)
  await page.goto(`${fixture.origin}/release-auth-lifecycle`, { waitUntil: 'domcontentloaded' })
  await waitForFixtureText(
    page,
    'auth-status',
    (value) => value === 'anonymous',
    'AUTH_EXPORT_SIGN_OUT_STATE',
  )
  const response = await context.request.get(`${fixture.origin}/api/auth/convex/token`)
  assert(response.status() === 200, 'AUTH_EXPORT_SIGN_OUT_TOKEN_STATUS_INVALID')
  const body = await response.json()
  assert(isRecord(body) && body.token === null, 'AUTH_EXPORT_SIGN_OUT_TOKEN_INVALID')
}

async function provisionOAuthProfile(context, fixture) {
  const headers = { origin: fixture.origin }
  await signInFixture(context, fixture)

  const convexTokenResponse = await context.request.get(`${fixture.origin}/api/auth/convex/token`, {
    headers,
  })
  assert(convexTokenResponse.ok(), 'AUTH_EXPORT_CONVEX_TOKEN_FAILED')
  const convexTokenBody = await convexTokenResponse.json()
  assert(
    isRecord(convexTokenBody) &&
      typeof convexTokenBody.token === 'string' &&
      /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(convexTokenBody.token),
    'AUTH_EXPORT_CONVEX_TOKEN_INVALID',
  )

  const publicResponse = await context.request.post(
    `${fixture.origin}/api/auth/mcp/admin/provision`,
    { data: {}, headers },
  )
  assert(publicResponse.ok(), 'AUTH_EXPORT_OAUTH_PROFILE_FAILED')
  const profile = await publicResponse.json()
  assert(
    isRecord(profile) &&
      isRecord(profile.clients) &&
      typeof profile.clients.inspector === 'string' &&
      profile.clients.inspector.length > 0 &&
      profile.resource === `${fixture.convexSiteUrl}/mcp`,
    'AUTH_EXPORT_OAUTH_PROFILE_INVALID',
  )

  const confidentialResponse = await context.request.post(
    `${fixture.origin}/api/auth/mcp/admin/provision-confidential`,
    { data: {}, headers },
  )
  assert(confidentialResponse.ok(), 'AUTH_EXPORT_CONFIDENTIAL_PROFILE_FAILED')
  const confidential = await confidentialResponse.json()
  assert(
    isRecord(confidential) &&
      isRecord(confidential.client) &&
      typeof confidential.client.secret === 'string' &&
      confidential.client.secret.length >= 16 &&
      confidential.client.secret.length <= 512,
    'AUTH_EXPORT_CONFIDENTIAL_SECRET_INVALID',
  )
  fixture.registerConfidentialClientSecretForRedaction(confidential.client.secret)
  return Object.freeze({
    clientId: profile.clients.inspector,
    clientSecret: confidential.client.secret,
    convexSessionJwt: convexTokenBody.token,
    resource: profile.resource,
  })
}

async function acquireAuthorizationCode(page, fixture, profile) {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  const authorize = new URL(`${fixture.origin}/api/auth/oauth2/authorize`)
  authorize.search = new URLSearchParams({
    client_id: profile.clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
    redirect_uri: CALLBACK,
    resource: profile.resource,
    response_type: 'code',
    scope: SCOPE,
    state,
  }).toString()
  await page.goto(authorize.href, { waitUntil: 'domcontentloaded' })

  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  let approved = false
  while (Date.now() < deadline) {
    const current = new URL(page.url())
    if (current.origin === new URL(CALLBACK).origin && current.pathname === '/oauth/callback') {
      assert(current.searchParams.get('state') === state, 'AUTH_EXPORT_OAUTH_STATE_MISMATCH')
      assert(
        current.searchParams.get('iss') === `${fixture.origin}/api/auth`,
        'AUTH_EXPORT_OAUTH_ISSUER_MISMATCH',
      )
      const code = current.searchParams.get('code')
      assert(
        typeof code === 'string' && code.length >= 16 && code.length <= 512,
        'AUTH_EXPORT_OAUTH_CODE_INVALID',
      )
      return Object.freeze({ code, verifier })
    }
    assert(current.origin === fixture.origin, 'AUTH_EXPORT_OAUTH_BROWSER_ESCAPE')
    const approve = page.getByTestId('approve-consent')
    if (!approved && (await approve.isVisible().catch(() => false))) {
      await approve.click()
      approved = true
      continue
    }
    const alert = page.getByRole('alert').first()
    assert(!(await alert.isVisible().catch(() => false)), 'AUTH_EXPORT_OAUTH_AUTHORIZATION_FAILED')
    await page.waitForTimeout(100)
  }
  throw new Error('AUTH_EXPORT_OAUTH_AUTHORIZATION_TIMEOUT')
}

async function redeemAuthorizationCode(fixture, profile, grant) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${fixture.origin}/api/auth/oauth2/token`, {
      body: new URLSearchParams({
        client_id: profile.clientId,
        code: grant.code,
        code_verifier: grant.verifier,
        grant_type: 'authorization_code',
        redirect_uri: CALLBACK,
        resource: profile.resource,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: fixture.origin },
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await response.text()
    assert(Buffer.byteLength(text) <= 64 * 1024, 'AUTH_EXPORT_OAUTH_TOKEN_RESPONSE_TOO_LARGE')
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error('AUTH_EXPORT_OAUTH_TOKEN_RESPONSE_INVALID')
    }
    assert(
      response.status === 200 &&
        isRecord(body) &&
        typeof body.access_token === 'string' &&
        /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(body.access_token) &&
        body.token_type === 'Bearer' &&
        body.scope === SCOPE &&
        body.refresh_token === undefined &&
        body.id_token === undefined,
      'AUTH_EXPORT_OAUTH_TOKEN_RESPONSE_INVALID',
    )
    return body.access_token
  } finally {
    clearTimeout(timer)
  }
}

async function exportAndScan(fixture, scratchDirectory, sentinels) {
  const archive = path.join(scratchDirectory, 'snapshot.zip')
  await runCaptured(
    sentinels,
    'convex-export',
    process.execPath,
    ['--', convexCli, 'export', '--path', archive, '--env-file', '.env.local'],
    { cwd: fixture.cwd },
  )
  const archiveMetadata = await lstat(archive)
  assert(
    archiveMetadata.isFile() && !archiveMetadata.isSymbolicLink(),
    'AUTH_EXPORT_ARCHIVE_INVALID',
  )
  assert(
    archiveMetadata.size <= MAX_EXPORT_ARCHIVE_BYTES,
    'AUTH_EXPORT_ARCHIVE_SIZE_BOUND_EXCEEDED',
  )

  const listing = await runCaptured(sentinels, 'export-list', 'unzip', ['-Z1', archive])
  const entries = listing.split(/\r?\n/gu).filter(Boolean)
  validateExportArchiveEntries(entries)
  parseExportArchiveTotals(
    await runCaptured(sentinels, 'export-totals', 'unzip', ['-Z', '-t', archive]),
    entries.length,
  )
  const extracted = path.join(scratchDirectory, 'extracted')
  await mkdir(extracted, { mode: 0o700 })
  await runCaptured(sentinels, 'export-extract', 'unzip', ['-qq', archive, '-d', extracted])

  const walked = await walkExportFiles(extracted)
  const relativeFiles = walked.files.map((file) =>
    path.relative(extracted, file).split(path.sep).join('/'),
  )
  assertComponentExportCoverage(relativeFiles)
  const extractedFiles = await Promise.all(
    walked.files.map(async (file) => ({
      path: path.relative(extracted, file).split(path.sep).join('/'),
      value: await readFile(file),
    })),
  )
  const surfaces = [
    { category: 'database', location: 'database.export.archive', value: await readFile(archive) },
    ...extractedFiles.map((file) => ({
      category: 'database',
      location: `database.export.files[${JSON.stringify(file.path)}]`,
      value: file.value,
    })),
  ]
  const report = scanSecretSentinelSurfaces(sentinels, surfaces)
  assertComponentExportRows(extractedFiles)
  return Object.freeze({
    bytes: walked.totalBytes,
    files: walked.files.length,
    leaves: report.leavesScanned,
    tables: REQUIRED_COMPONENT_TABLES.length,
  })
}

export async function main() {
  const runId = `bcn-${randomUUID()}`
  let sentinels = createSecretSentinels(runId)
  let scratchDirectory
  let fixture
  let browser
  let context
  let report
  let runFailure
  try {
    scratchDirectory = await mkdtemp(path.join(tmpdir(), 'bcn-auth-export-sentinels-'))
    await chmod(scratchDirectory, 0o700)
    assertOAuthBrowserStorageCoverage(await readFile(oauthRunner, 'utf8'))
    const { startLocalMcpOAuthFixture } = await import('./mcp-local-fixture.mjs')
    fixture = await startLocalMcpOAuthFixture({
      nuxtModeForTest: process.env.BCN_RELEASE_TARBALL ? 'production' : 'development',
      prepareFixture: ({ cwd }) => installFixtureAction(cwd, runId),
      secretOverridesForTest: {
        betterAuthSecrets: `2:${sentinels['better-auth-current-secret']},1:${sentinels['better-auth-prior-secret']}`,
        proxyIpSecret: sentinels['proxy-ip-secret'],
      },
    })

    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { height: 900, width: 1_440 } })
    await context.route(`${CALLBACK}**`, (route) =>
      route.fulfill({
        body: 'OAuth callback received.',
        contentType: 'text/plain; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
        status: 200,
      }),
    )
    await assertAnonymousBootstrap(context, fixture)
    const profile = await provisionOAuthProfile(context, fixture)
    sentinels = replaceSecretSentinel(sentinels, 'oauth-client-secret', profile.clientSecret)
    sentinels = replaceSecretSentinel(sentinels, 'convex-session-jwt', profile.convexSessionJwt)

    const page = await context.newPage()
    await assertAuthenticatedLifecycle(page, context, fixture)
    await revokeCurrentSession(browser, page, context, fixture)
    await signInFixture(context, fixture)
    const pending = await acquireAuthorizationCode(page, fixture, profile)
    sentinels = replaceSecretSentinel(sentinels, 'authorization-code', pending.code)
    sentinels = replaceSecretSentinel(sentinels, 'pkce-code-verifier', pending.verifier)
    const redeemable = await acquireAuthorizationCode(page, fixture, profile)
    const accessToken = await redeemAuthorizationCode(fixture, profile, redeemable)
    sentinels = replaceSecretSentinel(sentinels, 'oauth-access-token', accessToken)
    await assertSignOutLifecycle(page, context, fixture)
    await page.close()

    const seeded = await fixture.runConvex('authExportSentinelFixture:seedEncryptedCredentials', {
      runId,
    })
    assert(
      typeof seeded === 'string' && seeded.includes('AUTH_EXPORT_SENTINEL_SEEDED'),
      'AUTH_EXPORT_SENTINEL_SEED_INVALID',
    )
    report = await exportAndScan(fixture, scratchDirectory, sentinels)
  } catch (error) {
    runFailure = error
  } finally {
    try {
      await runFailClosedCleanup([
        async () => await context?.close(),
        async () => await browser?.close(),
        async () => await fixture?.release(),
        async () => {
          if (scratchDirectory) {
            await rm(scratchDirectory, { force: true, recursive: true })
          }
        },
      ])
    } catch {
      runFailure = runFailure
        ? new Error('AUTH_EXPORT_RUN_AND_CLEANUP_FAILED')
        : new Error('AUTH_EXPORT_CLEANUP_FAILED')
    }
  }

  if (runFailure) {
    console.error(`[auth-export-sentinels] FAIL: ${safeFailureMessage(runFailure, sentinels)}`)
    process.exitCode = 1
    return
  }
  assert(report, 'AUTH_EXPORT_REPORT_MISSING')
  console.log(
    `[auth-export-sentinels] PASS: real pinned component export; ${report.tables} credential-bearing tables, ${report.files} bounded files, ${report.bytes} uncompressed bytes, ${report.leaves} scanned leaves; browser local/session/cookies scanned and Cache Storage/IndexedDB absent.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
