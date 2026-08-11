#!/usr/bin/env node

import { fork } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

const CALLBACK = 'http://localhost:6274/oauth/callback'
const MCP_REMOTE_CALLBACK = 'http://127.0.0.1:3334/oauth/callback'
const SCOPE = 'mcp:read mcp:write'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 64 * 1024
const workerPath = fileURLToPath(import.meta.url)

function assert(condition, code) {
  if (!condition) throw new Error(code)
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function decodeJwtPart(token, index) {
  const part = token.split('.')[index]
  if (!part) return undefined
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}

function containsCompactJwt(value) {
  if (typeof value === 'string') {
    return /(?:^|\s)[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}(?:$|\s)/u.test(value)
  }
  if (Array.isArray(value)) return value.some(containsCompactJwt)
  if (!isRecord(value)) return false
  return Object.values(value).some(containsCompactJwt)
}

function safeWorkerFailureCode(error) {
  if (
    error instanceof Error &&
    /^OAUTH_CODE_[A-Z0-9_]{1,64}$/u.test(error.message) &&
    !error.message.includes('TOKEN')
  ) {
    return error.message
  }
  if (error instanceof Error && error.name === 'AbortError') return 'OAUTH_CODE_WORKER_TIMEOUT'
  if (error instanceof TypeError) return 'OAUTH_CODE_WORKER_TRANSPORT_FAILED'
  return 'OAUTH_CODE_WORKER_FAILED'
}

function validAccessToken(accessToken, expected) {
  if (typeof accessToken !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(accessToken)) {
    return false
  }
  const header = decodeJwtPart(accessToken, 0)
  const claims = decodeJwtPart(accessToken, 1)
  if (!isRecord(header) || !isRecord(claims)) return false
  const now = Math.floor(Date.now() / 1000)
  return (
    header.alg === 'RS256' &&
    header.typ === 'at+jwt' &&
    JSON.stringify(Object.keys(claims).sort()) ===
      JSON.stringify([
        'aud',
        'azp',
        'client_id',
        'exp',
        'iat',
        'iss',
        'jti',
        'scope',
        'sid',
        'sub',
        'token_use',
      ]) &&
    claims.iss === `${expected.origin}/api/auth` &&
    claims.aud === expected.resource &&
    claims.client_id === expected.clientId &&
    claims.azp === expected.clientId &&
    claims.scope === SCOPE &&
    claims.token_use === 'oauth-access' &&
    typeof claims.sub === 'string' &&
    claims.sub.length > 0 &&
    typeof claims.sid === 'string' &&
    claims.sid.length > 0 &&
    Number.isSafeInteger(claims.iat) &&
    Number.isSafeInteger(claims.exp) &&
    claims.iat <= now + 60 &&
    claims.exp > now &&
    claims.exp - claims.iat <= 600
  )
}

export function inspectTokenResponse(status, body, expected) {
  const accessToken = isRecord(body) ? body.access_token : undefined
  const credentialFields = isRecord(body)
    ? ['access_token', 'refresh_token', 'id_token'].filter(
        (field) => typeof body[field] === 'string' && body[field].length > 0,
      )
    : []
  const success =
    status === 200 &&
    credentialFields.length === 1 &&
    credentialFields[0] === 'access_token' &&
    isRecord(body) &&
    body.token_type === 'Bearer' &&
    body.scope === SCOPE &&
    Number.isSafeInteger(body.expires_in) &&
    body.expires_in > 0 &&
    body.expires_in <= 600 &&
    validAccessToken(accessToken, expected)
  const error =
    isRecord(body) && typeof body.error === 'string' && /^[a-z_]{1,64}$/u.test(body.error)
      ? body.error
      : undefined
  return {
    credentialFree: credentialFields.length === 0 && !containsCompactJwt(body),
    error,
    status,
    success,
  }
}

async function redeemInWorker(message) {
  const origin = new URL(message.origin)
  const endpoint = new URL(message.endpoint)
  const normalizedOrigin = message.origin === origin.origin
  const allowedOrigin =
    (origin.protocol === 'https:' && normalizedOrigin) ||
    (origin.protocol === 'http:' &&
      normalizedOrigin &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
  const authorizationAllowed =
    message.authorization === undefined ||
    (typeof message.authorization === 'string' &&
      message.authorization.length <= 2_048 &&
      /^Basic [A-Za-z0-9+/]+={0,2}$/u.test(message.authorization))
  const ingressCookieAllowed =
    message.ingressCookie === undefined ||
    (typeof message.ingressCookie === 'string' &&
      /^__Host-bcn-staging-lease=[\w-]{43,128}$/u.test(message.ingressCookie))
  if (
    !allowedOrigin ||
    !authorizationAllowed ||
    !ingressCookieAllowed ||
    endpoint.href !== `${origin.origin}/api/auth/oauth2/token` ||
    typeof message.body !== 'string' ||
    message.body.length === 0 ||
    message.body.length > 16 * 1024 ||
    !isRecord(message.expected)
  ) {
    throw new Error('OAUTH_CODE_WORKER_INPUT_INVALID')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, {
      body: message.body,
      headers: {
        ...(message.authorization ? { authorization: message.authorization } : {}),
        ...(message.ingressCookie ? { cookie: message.ingressCookie } : {}),
        'content-type': 'application/x-www-form-urlencoded',
        origin: origin.origin,
      },
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error('OAUTH_CODE_RESPONSE_TOO_LARGE')
    }
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return {
        credentialFree:
          !containsCompactJwt(text) &&
          !/(?:access_token|refresh_token|id_token)\s*[=:]/iu.test(text),
        error: response.status >= 500 ? 'server_error' : undefined,
        status: response.status,
        success: false,
      }
    }
    return inspectTokenResponse(response.status, body, message.expected)
  } finally {
    clearTimeout(timer)
  }
}

async function runRedemptionWorker() {
  assert(typeof process.send === 'function', 'OAUTH_CODE_WORKER_IPC_MISSING')
  process.send({ type: 'ready' })
  process.once('message', async (message) => {
    try {
      assert(isRecord(message) && message.type === 'redeem', 'OAUTH_CODE_WORKER_MESSAGE_INVALID')
      const result = await redeemInWorker(message)
      process.send?.({ result, type: 'result' })
    } catch (error) {
      process.send?.({ error: safeWorkerFailureCode(error), type: 'error' })
    } finally {
      process.disconnect()
    }
  })
}

function startRedemptionWorker() {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, ['--redemption-worker'], {
      env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('OAUTH_CODE_WORKER_READY_TIMEOUT'))
    }, REQUEST_TIMEOUT_MS)
    const fail = (error) => {
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(error instanceof Error ? error : new Error('OAUTH_CODE_WORKER_FAILED'))
    }
    child.once('error', fail)
    child.once('exit', (code) => {
      if (code !== 0 && code !== null) fail(new Error('OAUTH_CODE_WORKER_EXITED'))
    })
    child.on('message', (message) => {
      if (!isRecord(message) || message.type !== 'ready') return
      clearTimeout(timer)
      resolve({
        redeem: (request) =>
          new Promise((resolveRedemption, rejectRedemption) => {
            const redemptionTimer = setTimeout(() => {
              child.kill('SIGKILL')
              rejectRedemption(new Error('OAUTH_CODE_WORKER_RESPONSE_TIMEOUT'))
            }, REQUEST_TIMEOUT_MS)
            child.on('message', (resultMessage) => {
              if (!isRecord(resultMessage) || resultMessage.type === 'ready') return
              clearTimeout(redemptionTimer)
              if (resultMessage.type === 'result' && isRecord(resultMessage.result)) {
                resolveRedemption(resultMessage.result)
              } else if (
                resultMessage.type === 'error' &&
                typeof resultMessage.error === 'string' &&
                /^OAUTH_CODE_[A-Z0-9_]{1,64}$/u.test(resultMessage.error)
              ) {
                rejectRedemption(new Error(resultMessage.error))
              } else {
                rejectRedemption(new Error('OAUTH_CODE_WORKER_FAILED'))
              }
            })
            child.send({ ...request, type: 'redeem' }, (error) => {
              if (error) {
                clearTimeout(redemptionTimer)
                rejectRedemption(error)
              }
            })
          }),
      })
    })
  })
}

async function redeemOnce(request) {
  const worker = await startRedemptionWorker()
  return worker.redeem(request)
}

async function redeemRace(request) {
  const workers = await Promise.all([startRedemptionWorker(), startRedemptionWorker()])
  return Promise.all(workers.map((worker) => worker.redeem(request)))
}

function assertSuccess(result, code) {
  assert(result.success === true && result.status === 200, code)
}

function assertFailure(result, errors, code) {
  assert(
    result.success === false &&
      result.credentialFree === true &&
      result.status >= 400 &&
      result.status < 600 &&
      errors.includes(result.error),
    code,
  )
}

function tokenRequest(fixture, grant, overrides = {}) {
  const body = new URLSearchParams({
    client_id: fixture.clients.inspector,
    code: grant.code,
    code_verifier: grant.verifier,
    grant_type: 'authorization_code',
    redirect_uri: CALLBACK,
    resource: fixture.resource,
    ...overrides,
  }).toString()
  const clientId = overrides.client_id ?? fixture.clients.inspector
  return {
    body,
    endpoint: `${fixture.origin}/api/auth/oauth2/token`,
    expected: { clientId, origin: fixture.origin, resource: fixture.resource },
    ...(fixture.ingressCookie ? { ingressCookie: fixture.ingressCookie } : {}),
    origin: fixture.origin,
  }
}

function confidentialTokenRequest(fixture, grant, secret) {
  const clientId = fixture.clients.confidential.id
  const authorization = `Basic ${Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64')}`
  return {
    authorization,
    body: new URLSearchParams({
      code: grant.code,
      code_verifier: grant.verifier,
      grant_type: 'authorization_code',
      redirect_uri: CALLBACK,
      resource: fixture.resource,
    }).toString(),
    endpoint: `${fixture.origin}/api/auth/oauth2/token`,
    expected: { clientId, origin: fixture.origin, resource: fixture.resource },
    ...(fixture.ingressCookie ? { ingressCookie: fixture.ingressCookie } : {}),
    origin: fixture.origin,
  }
}

async function startCallbackServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'",
      'content-type': 'text/plain; charset=utf-8',
      'referrer-policy': 'no-referrer',
    })
    response.end('OAuth callback received.')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(6274, 'localhost', resolve)
  })
  return () =>
    new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

async function provisionProfile(context, fixture, { confidential = false } = {}) {
  const requestOptions = { headers: { origin: fixture.origin } }
  const signIn = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    ...requestOptions,
    data: { email: fixture.email, password: fixture.password },
  })
  assert(signIn.ok(), 'OAUTH_CODE_FIXTURE_SIGN_IN_FAILED')
  const response = await context.request.post(`${fixture.origin}/api/auth/mcp/admin/provision`, {
    ...requestOptions,
    data: {},
  })
  assert(response.ok(), 'OAUTH_CODE_FIXTURE_PROVISION_FAILED')
  const profile = await response.json()
  assert(
    isRecord(profile) &&
      isRecord(profile.clients) &&
      typeof profile.clients.inspector === 'string' &&
      profile.clients.inspector.length > 0 &&
      typeof profile.clients.mcpRemote === 'string' &&
      profile.clients.mcpRemote.length > 0 &&
      profile.clients.inspector !== profile.clients.mcpRemote &&
      profile.resource === `${fixture.convexSiteUrl}/mcp`,
    'OAUTH_CODE_FIXTURE_PROFILE_INVALID',
  )
  let confidentialClient
  if (confidential) {
    assert(
      typeof fixture.registerConfidentialClientSecretForRedaction === 'function',
      'OAUTH_CODE_FIXTURE_SECRET_REDACTION_MISSING',
    )
    const confidentialResponse = await context.request.post(
      `${fixture.origin}/api/auth/mcp/admin/provision-confidential`,
      { ...requestOptions, data: {} },
    )
    assert(confidentialResponse.ok(), 'OAUTH_CODE_FIXTURE_CONFIDENTIAL_PROVISION_FAILED')
    const confidentialProfile = await confidentialResponse.json()
    confidentialClient = isRecord(confidentialProfile) ? confidentialProfile.client : undefined
    if (
      isRecord(confidentialClient) &&
      typeof confidentialClient.secret === 'string' &&
      confidentialClient.secret.length >= 16 &&
      confidentialClient.secret.length <= 1_024
    ) {
      fixture.registerConfidentialClientSecretForRedaction(confidentialClient.secret)
    }
    assert(isRecord(confidentialClient), 'OAUTH_CODE_FIXTURE_CONFIDENTIAL_PROFILE_MISSING')
    assert(
      typeof confidentialClient.id === 'string' && confidentialClient.id.length > 0,
      'OAUTH_CODE_FIXTURE_CONFIDENTIAL_ID_INVALID',
    )
    assert(
      confidentialClient.id !== profile.clients.inspector &&
        confidentialClient.id !== profile.clients.mcpRemote,
      'OAUTH_CODE_FIXTURE_CONFIDENTIAL_ID_COLLISION',
    )
    assert(
      typeof confidentialClient.secret === 'string' &&
        confidentialClient.secret.length >= 16 &&
        confidentialClient.secret.length <= 1_024,
      'OAUTH_CODE_FIXTURE_CONFIDENTIAL_SECRET_INVALID',
    )
    assert(
      isRecord(confidentialProfile) && confidentialProfile.resource === profile.resource,
      'OAUTH_CODE_FIXTURE_CONFIDENTIAL_RESOURCE_INVALID',
    )
  }
  return {
    clients: {
      ...profile.clients,
      ...(confidentialClient ? { confidential: confidentialClient } : {}),
    },
    resource: profile.resource,
  }
}

async function readPersistedTokenCounts(fixture) {
  assert(
    typeof fixture.readOAuthCredentialCountsForTest === 'function',
    'OAUTH_CODE_TOKEN_COUNTS_SEAM_MISSING',
  )
  const counts = await fixture.readOAuthCredentialCountsForTest()
  assert(
    isRecord(counts) &&
      Object.keys(counts).sort().join(',') === 'accessTokens,idTokens,refreshTokens' &&
      [counts.accessTokens, counts.idTokens, counts.refreshTokens].every(
        (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100,
      ),
    'OAUTH_CODE_TOKEN_COUNTS_INVALID',
  )
  assert(
    counts.idTokens === 0 && counts.refreshTokens === 0,
    'OAUTH_CODE_DISABLED_TOKEN_CLASS_PERSISTED',
  )
  return Object.freeze({
    accessTokens: counts.accessTokens,
    idTokens: counts.idTokens,
    refreshTokens: counts.refreshTokens,
  })
}

async function assertPersistedTokenCountsUnchanged(fixture, before, code) {
  const after = await readPersistedTokenCounts(fixture)
  assert(
    after.accessTokens === before.accessTokens &&
      after.idTokens === before.idTokens &&
      after.refreshTokens === before.refreshTokens,
    code,
  )
}

async function acquireAuthorizationCode(page, fixture, clientId = fixture.clients.inspector) {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  const authorize = new URL(`${fixture.origin}/api/auth/oauth2/authorize`)
  authorize.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
    redirect_uri: CALLBACK,
    resource: fixture.resource,
    response_type: 'code',
    scope: SCOPE,
    state,
  }).toString()
  await page.goto(authorize.href, { waitUntil: 'domcontentloaded' })

  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  let signedIn = false
  let approved = false
  while (Date.now() < deadline) {
    const current = new URL(page.url())
    if (current.origin === new URL(CALLBACK).origin && current.pathname === '/oauth/callback') {
      assert(current.searchParams.getAll('code').length === 1, 'OAUTH_CODE_CALLBACK_CODE_INVALID')
      assert(current.searchParams.getAll('state').length === 1, 'OAUTH_CODE_CALLBACK_STATE_INVALID')
      assert(current.searchParams.getAll('iss').length === 1, 'OAUTH_CODE_CALLBACK_ISSUER_INVALID')
      assert(current.searchParams.get('state') === state, 'OAUTH_CODE_CALLBACK_STATE_MISMATCH')
      assert(
        current.searchParams.get('iss') === `${fixture.origin}/api/auth`,
        'OAUTH_CODE_CALLBACK_ISSUER_MISMATCH',
      )
      const code = current.searchParams.get('code')
      assert(code && code.length <= 512, 'OAUTH_CODE_CALLBACK_CODE_INVALID')
      return { code, verifier }
    }
    assert(current.origin === fixture.origin, 'OAUTH_CODE_BROWSER_ORIGIN_ESCAPE')

    const email = page.getByTestId('email')
    if (!signedIn && (await email.isVisible().catch(() => false))) {
      await email.fill(fixture.email)
      await page.getByTestId('password').fill(fixture.password)
      await page.getByTestId('sign-in').click()
      signedIn = true
      continue
    }
    const approve = page.getByTestId('approve-consent')
    if (!approved && (await approve.isVisible().catch(() => false))) {
      await approve.click()
      approved = true
      continue
    }
    const alert = page.getByRole('alert').first()
    if (await alert.isVisible().catch(() => false)) {
      throw new Error('OAUTH_CODE_BROWSER_AUTHORIZATION_FAILED')
    }
    await page.waitForTimeout(100)
  }
  throw new Error('OAUTH_CODE_BROWSER_AUTHORIZATION_TIMEOUT')
}

async function assertNoBrowserCredentialStorage(page, context, fixture) {
  await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' })
  const applicationStorage = await page.evaluate(async () => ({
    cacheNames: typeof caches === 'undefined' ? [] : await caches.keys(),
    indexedDbNames:
      typeof indexedDB.databases === 'function'
        ? (await indexedDB.databases()).map((database) => database.name ?? '')
        : [],
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }))
  const state = await context.storageState()
  const credentialName =
    /access.?token|authorization.?code|client.?secret|code.?verifier|convex.?jwt/iu
  assert(!containsCompactJwt(applicationStorage), 'OAUTH_CODE_BROWSER_STORAGE_TOKEN_LEAK')
  assert(
    [...applicationStorage.local, ...applicationStorage.session].every(
      ([name, value]) => !credentialName.test(name) && !credentialName.test(value),
    ),
    'OAUTH_CODE_BROWSER_STORAGE_CREDENTIAL_LEAK',
  )
  assert(
    applicationStorage.cacheNames.length === 0 && applicationStorage.indexedDbNames.length === 0,
    'OAUTH_CODE_BROWSER_STORAGE_CONTAINER_PRESENT',
  )
  assert(!containsCompactJwt(state), 'OAUTH_CODE_BROWSER_COOKIE_TOKEN_LEAK')
  assert(
    state.cookies.every((cookie) => !credentialName.test(cookie.name)),
    'OAUTH_CODE_BROWSER_CREDENTIAL_COOKIE',
  )
}

async function runAuthorizationCodeRace(page, fixture) {
  const racedGrant = await acquireAuthorizationCode(page, fixture)
  const race = await redeemRace(tokenRequest(fixture, racedGrant))
  const winners = race.filter((result) => result.success).length
  const rejected = race.filter((result) => !result.success).length
  assert(winners === 1, 'OAUTH_CODE_RACE_WINNER_COUNT')
  assert(rejected === 1, 'OAUTH_CODE_RACE_REJECTED_COUNT')
  assertFailure(
    race.find((result) => !result.success),
    ['invalid_grant'],
    'OAUTH_CODE_RACE_LOSER_INVALID',
  )
  assertFailure(
    await redeemOnce(tokenRequest(fixture, racedGrant)),
    ['invalid_grant'],
    'OAUTH_CODE_REPLAY_ACCEPTED',
  )
  return Object.freeze({ attempts: race.length, rejected, replayRejected: true, winners })
}

function normalizeExternalFixture(input) {
  assert(isRecord(input), 'OAUTH_CODE_EXTERNAL_FIXTURE_INVALID')
  assert(
    typeof input.origin === 'string' && input.origin.length > 0 && input.origin.length <= 2_048,
    'OAUTH_CODE_EXTERNAL_ORIGIN_INVALID',
  )
  let url
  try {
    url = new URL(input.origin)
  } catch {
    throw new Error('OAUTH_CODE_EXTERNAL_ORIGIN_INVALID')
  }
  assert(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    'OAUTH_CODE_EXTERNAL_ORIGIN_INVALID',
  )
  assert(
    typeof input.email === 'string' &&
      input.email.length > 0 &&
      input.email.length <= 320 &&
      ![...input.email].some((character) => {
        const code = character.codePointAt(0)
        return code !== undefined && (code <= 31 || code === 127)
      }),
    'OAUTH_CODE_EXTERNAL_EMAIL_INVALID',
  )
  assert(
    typeof input.password === 'string' &&
      input.password.length >= 8 &&
      input.password.length <= 1_024 &&
      ![...input.password].some((character) => {
        const code = character.codePointAt(0)
        return code === 0 || code === 10 || code === 13
      }),
    'OAUTH_CODE_EXTERNAL_PASSWORD_INVALID',
  )
  assert(
    typeof input.ingressLease === 'string' && /^[\w-]{43,128}$/u.test(input.ingressLease),
    'OAUTH_CODE_EXTERNAL_INGRESS_LEASE_INVALID',
  )
  return Object.freeze({
    email: input.email,
    ingressCookie: `__Host-bcn-staging-lease=${input.ingressLease}`,
    ingressLease: input.ingressLease,
    origin: url.origin,
    password: input.password,
  })
}

/** Attempt every teardown step, then fail with a stable non-secret code. */
export async function closeOAuthCodeResources(closeSteps) {
  let failed = false
  for (const close of closeSteps) {
    if (typeof close !== 'function') continue
    try {
      await close()
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error('OAUTH_CODE_CLEANUP_FAILED')
}

/**
 * Run the non-destructive authorization-code race against a pre-provisioned
 * HTTPS staging deployment. The result contains counts only; credentials,
 * authorization codes, verifiers, and token responses never cross this seam.
 */
export async function runExternalAuthorizationCodeRace(input) {
  const external = normalizeExternalFixture(input)
  let closeCallback
  let browser
  let context
  try {
    closeCallback = await startCallbackServer()
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { height: 900, width: 1440 } })
    await context.addCookies([
      {
        httpOnly: true,
        name: '__Host-bcn-staging-lease',
        sameSite: 'Strict',
        secure: true,
        url: external.origin,
        value: external.ingressLease,
      },
    ])
    const profile = await provisionProfile(context, external)
    const fixture = { ...external, ...profile }
    const page = await context.newPage()
    const summary = await runAuthorizationCodeRace(page, fixture)
    await page.close()
    return summary
  } finally {
    await closeOAuthCodeResources([
      context ? () => context.close() : undefined,
      browser ? () => browser.close() : undefined,
      closeCallback,
    ])
  }
}

async function runLiveMatrix(startFixture) {
  let fixtureHandle
  let closeCallback
  let browser
  let context
  try {
    fixtureHandle = await startFixture()
    closeCallback = await startCallbackServer()
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { height: 900, width: 1440 } })

    const profile = await provisionProfile(context, fixtureHandle, { confidential: true })
    const fixture = { ...fixtureHandle, ...profile }
    const page = await context.newPage()
    const initialTokenCounts = await readPersistedTokenCounts(fixture)
    assert(
      initialTokenCounts.accessTokens === 0,
      'OAUTH_CODE_FIXTURE_PERSISTED_ACCESS_TOKEN_NOT_EMPTY',
    )

    await runAuthorizationCodeRace(page, fixture)

    const resourceGrant = await acquireAuthorizationCode(page, fixture)
    const beforeResourceFailure = await readPersistedTokenCounts(fixture)
    assertFailure(
      await redeemOnce(
        tokenRequest(fixture, resourceGrant, { resource: `${fixture.origin}/wrong-resource` }),
      ),
      ['invalid_client'],
      'OAUTH_CODE_WRONG_RESOURCE_MINTED',
    )
    await assertPersistedTokenCountsUnchanged(
      fixture,
      beforeResourceFailure,
      'OAUTH_CODE_WRONG_RESOURCE_PERSISTED_TOKEN',
    )
    assertSuccess(
      await redeemOnce(tokenRequest(fixture, resourceGrant)),
      'OAUTH_CODE_RESOURCE_GUARD_BURNED_CODE',
    )

    const redirectGrant = await acquireAuthorizationCode(page, fixture)
    const beforeRedirectFailure = await readPersistedTokenCounts(fixture)
    assertFailure(
      await redeemOnce(
        tokenRequest(fixture, redirectGrant, {
          redirect_uri: 'http://localhost:6274/wrong-callback',
        }),
      ),
      ['invalid_request'],
      'OAUTH_CODE_WRONG_REDIRECT_MINTED',
    )
    await assertPersistedTokenCountsUnchanged(
      fixture,
      beforeRedirectFailure,
      'OAUTH_CODE_WRONG_REDIRECT_PERSISTED_TOKEN',
    )
    assertSuccess(
      await redeemOnce(tokenRequest(fixture, redirectGrant)),
      'OAUTH_CODE_REDIRECT_GUARD_BURNED_CODE',
    )

    const pkceGrant = await acquireAuthorizationCode(page, fixture)
    const beforePkceFailure = await readPersistedTokenCounts(fixture)
    const wrongVerifier = randomBytes(48).toString('base64url')
    assert(wrongVerifier !== pkceGrant.verifier, 'OAUTH_CODE_PKCE_FIXTURE_COLLISION')
    assertFailure(
      await redeemOnce(
        tokenRequest(fixture, pkceGrant, {
          code_verifier: wrongVerifier,
        }),
      ),
      ['invalid_request'],
      'OAUTH_CODE_WRONG_PKCE_MINTED',
    )
    assertFailure(
      await redeemOnce(tokenRequest(fixture, pkceGrant)),
      ['invalid_grant'],
      'OAUTH_CODE_WRONG_PKCE_DID_NOT_BURN',
    )
    await assertPersistedTokenCountsUnchanged(
      fixture,
      beforePkceFailure,
      'OAUTH_CODE_WRONG_PKCE_PERSISTED_TOKEN',
    )
    const freshPkceGrant = await acquireAuthorizationCode(page, fixture)
    assertSuccess(
      await redeemOnce(tokenRequest(fixture, freshPkceGrant)),
      'OAUTH_CODE_FRESH_PKCE_FLOW_FAILED',
    )

    const clientGrant = await acquireAuthorizationCode(page, fixture)
    const beforeClientFailure = await readPersistedTokenCounts(fixture)
    assertFailure(
      await redeemOnce(
        tokenRequest(fixture, clientGrant, {
          client_id: fixture.clients.mcpRemote,
          redirect_uri: MCP_REMOTE_CALLBACK,
        }),
      ),
      ['invalid_grant'],
      'OAUTH_CODE_WRONG_CLIENT_MINTED',
    )
    assertFailure(
      await redeemOnce(tokenRequest(fixture, clientGrant)),
      ['invalid_grant'],
      'OAUTH_CODE_WRONG_CLIENT_DID_NOT_BURN',
    )
    await assertPersistedTokenCountsUnchanged(
      fixture,
      beforeClientFailure,
      'OAUTH_CODE_WRONG_CLIENT_PERSISTED_TOKEN',
    )
    const freshGrant = await acquireAuthorizationCode(page, fixture)
    assertSuccess(
      await redeemOnce(tokenRequest(fixture, freshGrant)),
      'OAUTH_CODE_FRESH_FLOW_FAILED',
    )

    const confidentialClientId = fixture.clients.confidential.id
    const confidentialSecret = fixture.clients.confidential.secret
    const confidentialGrant = await acquireAuthorizationCode(page, fixture, confidentialClientId)
    const beforeBasicFailure = await readPersistedTokenCounts(fixture)
    const wrongSecret = randomBytes(48).toString('base64url')
    assert(wrongSecret !== confidentialSecret, 'OAUTH_CODE_CONFIDENTIAL_SECRET_COLLISION')
    assertFailure(
      await redeemOnce(confidentialTokenRequest(fixture, confidentialGrant, wrongSecret)),
      ['invalid_client'],
      'OAUTH_CODE_WRONG_BASIC_SECRET_MINTED',
    )
    assertFailure(
      await redeemOnce(confidentialTokenRequest(fixture, confidentialGrant, confidentialSecret)),
      ['invalid_grant'],
      'OAUTH_CODE_WRONG_BASIC_SECRET_DID_NOT_BURN',
    )
    await assertPersistedTokenCountsUnchanged(
      fixture,
      beforeBasicFailure,
      'OAUTH_CODE_WRONG_BASIC_SECRET_PERSISTED_TOKEN',
    )
    const freshConfidentialGrant = await acquireAuthorizationCode(
      page,
      fixture,
      confidentialClientId,
    )
    assertSuccess(
      await redeemOnce(
        confidentialTokenRequest(fixture, freshConfidentialGrant, confidentialSecret),
      ),
      'OAUTH_CODE_FRESH_CONFIDENTIAL_FLOW_FAILED',
    )

    const signingFaultGrant = await acquireAuthorizationCode(page, fixture)
    const beforeSigningFault = await readPersistedTokenCounts(fixture)
    await fixture.retireCurrentAuthSecretForTest()
    assertFailure(
      await redeemOnce(tokenRequest(fixture, signingFaultGrant)),
      ['server_error'],
      'OAUTH_CODE_POST_CONSUME_SIGNING_FAULT_MINTED',
    )
    assertFailure(
      await redeemOnce(tokenRequest(fixture, signingFaultGrant)),
      ['invalid_grant'],
      'OAUTH_CODE_POST_CONSUME_SIGNING_FAULT_DID_NOT_BURN',
    )
    await assertPersistedTokenCountsUnchanged(
      fixture,
      beforeSigningFault,
      'OAUTH_CODE_POST_CONSUME_SIGNING_FAULT_PERSISTED_TOKEN',
    )
    await fixture.runConvex('auth:rotateSigningKey')
    const recoveredGrant = await acquireAuthorizationCode(page, fixture)
    assertSuccess(
      await redeemOnce(tokenRequest(fixture, recoveredGrant)),
      'OAUTH_CODE_POST_SIGNING_FAULT_RECOVERY_FAILED',
    )

    await assertNoBrowserCredentialStorage(page, context, fixture)

    await page.close()
    console.log(
      '[oauth-code-concurrency] PASS: one winner across two child processes; replay denied; pre-provider resource/redirect rejection preserved the code; provider-forwarded wrong PKCE, valid alternate-client, confidential Basic-secret, and post-consume signing-fault paths burned their codes; key rotation restored fresh authorization.',
    )
  } finally {
    await closeOAuthCodeResources([
      context ? () => context.close() : undefined,
      browser ? () => browser.close() : undefined,
      closeCallback,
      fixtureHandle ? () => fixtureHandle.release() : undefined,
    ])
  }
}

export async function main() {
  const { startLocalMcpOAuthFixture } = await import('./mcp-local-fixture.mjs')
  assert(typeof startLocalMcpOAuthFixture === 'function', 'OAUTH_CODE_FIXTURE_HELPER_MISSING')
  await runLiveMatrix(startLocalMcpOAuthFixture)
}

if (process.argv[2] === '--redemption-worker') {
  runRedemptionWorker().catch(() => {
    process.exitCode = 1
  })
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
