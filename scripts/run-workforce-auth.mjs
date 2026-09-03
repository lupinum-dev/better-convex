#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { createJiti } from 'jiti'
import WebSocket from 'ws'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const origin = 'http://localhost:3050'
const proxySecret = 'better-convex-nuxt-e2e-proxy-ip-secret-32-bytes'
const password = `Workforce-fixture-${randomUUID()}`
const email = `workforce-${randomUUID()}@example.test`
const componentPath = 'betterAuth'
const functions = {
  find: makeFunctionReference('adapter:findOne'),
  update: makeFunctionReference('adapter:updateOne'),
  current: makeFunctionReference('identity:current'),
  managementDenied: makeFunctionReference('identity:managementDenied'),
  sessions: makeFunctionReference('identity:sessions'),
  touch: makeFunctionReference('identity:touch'),
  revoke: makeFunctionReference('identity:revoke'),
  revokeAll: makeFunctionReference('identity:revokeAll'),
  accelerateExpiry: makeFunctionReference('expiryProof:accelerate'),
}

function assert(condition, code) {
  if (!condition) throw new Error(code)
}

function string(value, code) {
  assert(typeof value === 'string' && value.length > 0, code)
  return value
}

function assertPrivateFieldsHidden(value) {
  if (!value || typeof value !== 'object') return
  for (const [name, child] of Object.entries(value)) {
    assert(!name.startsWith('bcn'), 'WORKFORCE_PRIVATE_FIELD_EXPOSED')
    assertPrivateFieldsHidden(child)
  }
}

class CookieJar {
  cookies = new Map()

  apply(headers) {
    for (const value of headers.getSetCookie()) {
      const pair = value.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const cookie = pair.slice(separator + 1)
      if (!cookie || /(?:^|;)\s*max-age=0(?:;|$)/iu.test(value)) this.cookies.delete(name)
      else this.cookies.set(name, cookie)
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

async function totp(secret) {
  const phase = Math.floor(Date.now() / 1_000) % 30
  if (phase >= 27) await new Promise((resolveWait) => setTimeout(resolveWait, (31 - phase) * 1_000))
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const character of secret.toUpperCase().replace(/=+$/u, '')) {
    const value = alphabet.indexOf(character)
    assert(value >= 0, 'WORKFORCE_TOTP_SECRET_FORMAT')
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest.at(-1) & 15
  return String((digest.readUInt32BE(offset) & 2_147_483_647) % 1_000_000).padStart(6, '0')
}

async function freshTotp(secret, previous) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await totp(secret)
    if (code !== previous) return code
    await new Promise((resolveWait) => setTimeout(resolveWait, 30_100 - (Date.now() % 30_000)))
  }
  throw new Error('WORKFORCE_FRESH_CODE_UNAVAILABLE')
}

function isolatedFixture() {
  const parent = mkdtempSync(join(tmpdir(), 'bcn-workforce-http-'))
  const cwd = join(parent, 'app')
  cpSync(join(root, 'test/fixtures/workforce-http'), cwd, { recursive: true })
  mkdirSync(join(cwd, 'node_modules/@lupinum'), { recursive: true })
  symlinkSync(root, join(cwd, 'node_modules/@lupinum/better-convex-nuxt'), 'dir')
  // The temporary app resolves the exact reviewed installed dependency graph.
  symlinkSync(join(root, 'node_modules'), join(parent, 'node_modules'), 'dir')
  return { cwd, parent }
}

function localAdminKey(cwd) {
  const config = JSON.parse(readFileSync(join(cwd, '.convex/local/default/config.json'), 'utf8'))
  assert(
    typeof config.deploymentName === 'string' &&
      typeof config.adminKey === 'string' &&
      config.adminKey.startsWith(`${config.deploymentName}|`) &&
      config.adminKey.length > config.deploymentName.length + 33,
    'WORKFORCE_LOCAL_ADMIN_KEY_INVALID',
  )
  return config.adminKey
}

async function deniedQuery(client) {
  try {
    await client.query(functions.current, {})
  } catch (error) {
    assert(
      error instanceof Error &&
        /Unauthenticated|unauthenticated|UNAUTHENTICATED/u.test(error.message),
      'WORKFORCE_QUERY_UNEXPECTED_FAILURE',
    )
    return
  }
  throw new Error('WORKFORCE_QUERY_UNEXPECTED_ADMISSION')
}

async function proveOpenSubscriptionExpiry({
  url,
  token,
  userId,
  sessionId,
  admin,
  survivingClient,
}) {
  const admitted = Promise.withResolvers()
  const authenticated = Promise.withResolvers()
  const expired = Promise.withResolvers()
  const failed = Promise.withResolvers()
  let socket
  let unsubscribe
  let timer
  let observedAdmission = false
  let accelerationStarted = false
  let closing = false
  const fail = (code) => failed.reject(new Error(code))
  // A reconnect could prove only fresh admission denial, not invalidation of an
  // already open subscription. Any transport interruption fails this proof.
  class ProofWebSocket extends WebSocket {
    constructor(...args) {
      super(...args)
      this.on('close', () => {
        if (!closing) fail('WORKFORCE_EXPIRY_SOCKET_CLOSED')
      })
      this.on('error', () => {
        if (!closing) fail('WORKFORCE_EXPIRY_SOCKET_FAILED')
      })
    }
  }
  try {
    timer = setTimeout(() => fail('WORKFORCE_EXPIRY_SUBSCRIPTION_TIMEOUT'), 15_000)
    const proof = (async () => {
      socket = new ConvexClient(url, {
        logger: false,
        webSocketConstructor: ProofWebSocket,
        onServerDisconnectError: () => fail('WORKFORCE_EXPIRY_SERVER_DISCONNECTED'),
      })
      socket.setAuth(
        async () => token,
        (accepted) => {
          if (accepted) authenticated.resolve()
          else fail('WORKFORCE_EXPIRY_SOCKET_AUTH_REJECTED')
        },
      )
      await authenticated.promise
      unsubscribe = socket.onUpdate(
        functions.current,
        {},
        (value) => {
          if (value !== userId) {
            fail('WORKFORCE_EXPIRY_SUBSCRIPTION_UNEXPECTED_VALUE')
            return
          }
          observedAdmission = true
          admitted.resolve()
        },
        (error) => {
          if (
            observedAdmission &&
            accelerationStarted &&
            error instanceof Error &&
            /Unauthenticated|unauthenticated|UNAUTHENTICATED/u.test(error.message)
          )
            expired.resolve()
          else fail('WORKFORCE_EXPIRY_SUBSCRIPTION_UNEXPECTED_ERROR')
        },
      )
      await admitted.promise
      assert(
        (await survivingClient.query(functions.current, {})) === userId,
        'WORKFORCE_EXPIRY_SURVIVOR_INITIAL_DENIAL',
      )
      accelerationStarted = true
      // Fixture-only time acceleration; production shortening remains forbidden.
      await admin.function(functions.accelerateExpiry, componentPath, { userId, sessionId })
      await expired.promise
      const remaining = await admin.function(functions.find, componentPath, {
        model: 'session',
        where: [{ field: 'id', value: sessionId }],
        select: ['id'],
      })
      assert(remaining === null, 'WORKFORCE_EXPIRY_CANONICAL_ROW_REMAINS')
      const expiredClient = new ConvexHttpClient(url, { logger: false })
      expiredClient.setAuth(token)
      await deniedQuery(expiredClient)
      assert(
        (await survivingClient.query(functions.current, {})) === userId,
        'WORKFORCE_EXPIRY_CHANGED_OTHER_SESSION',
      )
      return {
        admittedBefore: true,
        uninterruptedSubscriptionDenied: true,
        canonicalRowDeleted: true,
        httpDenied: true,
        otherSessionAdmitted: true,
      }
    })()
    return await Promise.race([proof, failed.promise])
  } finally {
    closing = true
    clearTimeout(timer)
    unsubscribe?.()
    await socket?.close()
  }
}

async function run() {
  assert(process.argv.length === 2, 'WORKFORCE_RUNNER_ARGUMENTS_UNSUPPORTED')
  const isolated = isolatedFixture()
  let local
  let stage = 'schema-generation'
  try {
    // No implicit package build: the coordinator supplies the current built package.
    execFileSync(
      process.execPath,
      [
        join(root, 'dist/runtime/cli/index.js'),
        'auth',
        'schema',
        '--config',
        'convex/betterAuth/schemaOptions.ts',
      ],
      { cwd: isolated.cwd, stdio: 'pipe' },
    )
    process.env.CONVEX_E2E_AUTO_START = 'true'
    process.env.BCN_E2E_REQUIRE_LOCAL = 'true'
    for (const name of [
      'CONVEX_URL',
      'CONVEX_SITE_URL',
      'CONVEX_DEPLOYMENT',
      'NUXT_PUBLIC_CONVEX_URL',
      'NUXT_PUBLIC_CONVEX_SITE_URL',
    ]) {
      delete process.env[name]
    }
    const jiti = createJiti(import.meta.url, { interopDefault: false })
    const { ensureLocalConvex } = await jiti.import('../test/helpers/local-convex.ts')
    stage = 'local-backend'
    local = await ensureLocalConvex({ cwd: isolated.cwd, timeoutMs: 120_000, authOrigin: origin })
    stage = 'fixture-typecheck'
    execFileSync(
      process.execPath,
      [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'convex/tsconfig.json'],
      { cwd: isolated.cwd, stdio: 'pipe' },
    )
    const url = string(local.env.CONVEX_URL, 'WORKFORCE_LOCAL_URL_MISSING')
    const siteUrl = string(local.env.CONVEX_SITE_URL, 'WORKFORCE_LOCAL_SITE_MISSING')
    const admin = new ConvexHttpClient(url, { logger: false })
    admin.setAdminAuth(localAdminKey(isolated.cwd))
    let requestNumber = 0
    async function request(jar, path, body) {
      const ip = `192.0.2.${++requestNumber}`
      const signature = createHmac('sha256', proxySecret).update(`v1\n${ip}`).digest('base64url')
      const response = await fetch(`${siteUrl}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          cookie: jar.header(),
          'x-bcn-client-ip': ip,
          'x-bcn-client-ip-signature': signature,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      })
      jar.apply(response.headers)
      assert(!response.headers.has('set-auth-jwt'), 'WORKFORCE_UNEXPECTED_JWT_HEADER')
      assert(!response.headers.has('set-auth-token'), 'WORKFORCE_UNEXPECTED_TOKEN_HEADER')
      const responseBody = await response.json()
      assertPrivateFieldsHidden(responseBody)
      return { status: response.status, body: responseBody }
    }
    async function noToken(jar) {
      const result = await request(jar, '/convex/token')
      assert(
        (result.status === 401 || result.status === 403 || result.status === 200) &&
          !result.body?.token,
        'WORKFORCE_RESTRICTED_TOKEN_MINTED',
      )
    }
    async function signIn(jar) {
      const result = await request(jar, '/sign-in/email', { email, password })
      assert(result.status === 200, 'WORKFORCE_PASSWORD_SIGN_IN_FAILED')
      return result.body
    }

    stage = 'signup'
    const setup = new CookieJar()
    const signup = await request(setup, '/sign-up/email', {
      email,
      name: 'Workforce fixture',
      password,
    })
    assert(signup.status === 200 && !signup.body?.token, 'WORKFORCE_SIGNUP_FAILED')
    const userId = string(signup.body?.user?.id, 'WORKFORCE_SIGNUP_USER_MISSING')
    // Mailbox delivery is not this fixture's claim. Bootstrap only the synthetic
    // account's verified-mailbox precondition through the admin-only component API.
    await admin.function(functions.update, componentPath, {
      model: 'user',
      where: [{ field: 'id', value: userId }],
      update: { emailVerified: true },
    })
    stage = 'password-only'
    await signIn(setup)
    await noToken(setup)

    stage = 'enroll'
    const enrollment = await request(setup, '/two-factor/enable', { method: 'totp', password })
    assert(enrollment.status === 200, 'WORKFORCE_ENROLLMENT_FAILED')
    const uri = new URL(string(enrollment.body?.totpURI, 'WORKFORCE_TOTP_URI_MISSING'))
    const secret = string(uri.searchParams.get('secret'), 'WORKFORCE_TOTP_SECRET_MISSING')
    const recoveryCodes = enrollment.body?.backupCodes
    assert(
      Array.isArray(recoveryCodes) && recoveryCodes.length > 1,
      'WORKFORCE_BACKUP_CODES_MISSING',
    )
    await noToken(setup)
    stage = 'confirm'
    const enrollmentCode = await totp(secret)
    const confirmed = await request(setup, '/two-factor/verify-totp', { code: enrollmentCode })
    assert(confirmed.status === 200, 'WORKFORCE_CONFIRMATION_FAILED')
    await noToken(setup)

    stage = 'enrollment-replay'
    const replay = new CookieJar()
    await signIn(replay)
    const replayed = await request(replay, '/two-factor/verify-totp', { code: enrollmentCode })
    assert(
      replayed.status === 403 && replayed.body?.code === 'INVALID_TWO_FACTOR_CODE',
      'WORKFORCE_ENROLLMENT_CODE_REUSED',
    )
    await noToken(replay)

    stage = 'concurrent-full-sign-in'
    const contenders = [new CookieJar(), new CookieJar()]
    for (const jar of contenders) {
      assert((await signIn(jar)).twoFactorRedirect === true, 'WORKFORCE_SECOND_FACTOR_NOT_REQUIRED')
      await noToken(jar)
    }
    const fullCode = await freshTotp(secret, enrollmentCode)
    const verified = await Promise.all(
      contenders.map((jar) => request(jar, '/two-factor/verify-totp', { code: fullCode })),
    )
    assert(
      verified.filter((result) => result.status === 200).length === 1 &&
        verified.filter(
          (result) => result.status === 403 && result.body?.code === 'INVALID_TWO_FACTOR_CODE',
        ).length === 1,
      'WORKFORCE_CONCURRENT_REPLAY_ADMITTED',
    )
    const full = contenders[verified.findIndex((result) => result.status === 200)]
    await noToken(contenders[verified.findIndex((result) => result.status === 403)])
    const minted = await request(full, '/convex/token')
    assert(minted.status === 200, 'WORKFORCE_FULL_TOKEN_FAILED')
    const token = string(minted.body?.token, 'WORKFORCE_FULL_TOKEN_MISSING')
    const client = new ConvexHttpClient(url, { logger: false })
    client.setAuth(token)
    assert(
      (await client.query(functions.current, {})) === userId,
      'WORKFORCE_BACKEND_ADMISSION_FAILED',
    )
    assert(
      (await client.action(functions.managementDenied, {})) === true,
      'WORKFORCE_UNSUPPORTED_MANAGEMENT_NOT_DENIED',
    )
    stage = 'session-list'
    const sessions = await client.query(functions.sessions, {})
    const currentSession = sessions.find((session) => session.isCurrent)
    assert(
      currentSession && currentSession.expiresAt <= Date.now() + 3_600_000,
      'WORKFORCE_IDLE_DEADLINE_INVALID',
    )
    stage = 'session-touch'
    const touched = await client.mutation(functions.touch, {})
    assert(
      touched >= currentSession.expiresAt && touched <= Date.now() + 3_600_000,
      'WORKFORCE_TOUCH_INVALID',
    )
    stage = 'session-revoke-missing'
    await client.mutation(functions.revoke, { sessionId: 'synthetic-missing-session' })
    assert(
      (await client.query(functions.current, {})) === userId,
      'WORKFORCE_REVOKE_MISSING_CHANGED_ACTOR',
    )

    stage = 'recovery'
    const recovery = new CookieJar()
    assert(
      (await signIn(recovery)).twoFactorRedirect === true,
      'WORKFORCE_RECOVERY_CHALLENGE_MISSING',
    )
    const recovered = await request(recovery, '/two-factor/verify-backup-code', {
      code: recoveryCodes[0],
    })
    assert(recovered.status === 200, 'WORKFORCE_RECOVERY_FAILED')
    await noToken(recovery)
    await deniedQuery(client)
    await noToken(full)
    assert(
      (await request(full, '/get-session')).status === 403,
      'WORKFORCE_REVOKED_GET_SESSION_ADMITTED',
    )

    stage = 'final-full-sign-in'
    const finalJar = new CookieJar()
    await signIn(finalJar)
    const finalCode = await freshTotp(secret, fullCode)
    assert(
      (await request(finalJar, '/two-factor/verify-totp', { code: finalCode })).status === 200,
      'WORKFORCE_FINAL_SIGN_IN_FAILED',
    )
    const finalToken = await request(finalJar, '/convex/token')
    client.setAuth(string(finalToken.body?.token, 'WORKFORCE_FINAL_TOKEN_MISSING'))

    stage = 'open-subscription-expiry-sign-in'
    const expiryJar = new CookieJar()
    assert(
      (await signIn(expiryJar)).twoFactorRedirect === true,
      'WORKFORCE_EXPIRY_CHALLENGE_MISSING',
    )
    const expiryCode = await freshTotp(secret, finalCode)
    assert(
      (await request(expiryJar, '/two-factor/verify-totp', { code: expiryCode })).status === 200,
      'WORKFORCE_EXPIRY_SIGN_IN_FAILED',
    )
    const expiryMinted = await request(expiryJar, '/convex/token')
    assert(expiryMinted.status === 200, 'WORKFORCE_EXPIRY_TOKEN_FAILED')
    const expiryToken = string(expiryMinted.body?.token, 'WORKFORCE_EXPIRY_TOKEN_MISSING')
    const expiryClient = new ConvexHttpClient(url, { logger: false })
    expiryClient.setAuth(expiryToken)
    const expirySessions = await expiryClient.query(functions.sessions, {})
    const expirySessionId = string(
      expirySessions.find((session) => session.isCurrent)?.sessionId,
      'WORKFORCE_EXPIRY_SESSION_MISSING',
    )
    stage = 'open-subscription-expiry'
    const expiryEvidence = await proveOpenSubscriptionExpiry({
      url,
      token: expiryToken,
      userId,
      sessionId: expirySessionId,
      admin,
      survivingClient: client,
    })
    console.log('Workforce open WebSocket expiry proof:', expiryEvidence)

    stage = 'revoke-all'
    await client.mutation(functions.revokeAll, {})
    await deniedQuery(client)
    await noToken(finalJar)
    const finalSession = await request(finalJar, '/get-session')
    assert(
      finalSession.status === 403 || (finalSession.status === 200 && finalSession.body === null),
      'WORKFORCE_REVOKE_ALL_GET_SESSION_ADMITTED',
    )
    const canonicalUser = await admin.function(functions.find, componentPath, {
      model: 'user',
      where: [{ field: 'id', value: userId }],
      select: ['bcnSecurityGeneration'],
    })
    assert(
      Number.isSafeInteger(canonicalUser?.bcnSecurityGeneration),
      'WORKFORCE_GENERATION_MISSING',
    )
    console.log(
      'Workforce real HTTP/component proof passed: restricted enrollment, cross-challenge TOTP replay denial, concurrent single admission, idle touch, restricted recovery, open WebSocket expiry, and session revocation.',
    )
  } catch (error) {
    // Never print provider responses, session material, generated secrets, or raw
    // child-process errors. The stage identifies the bounded proof that failed.
    if (error instanceof Error) {
      const diagnostics = error.message.match(
        /AUTH_[A-Z_]+|TS\d{4}|EACCES|EPERM|ECONNREFUSED|ENOTFOUND|ENOENT|Could not resolve|Cannot find module|Could not find public function|ArgumentValidationError|ReturnsValidationError|Timed out|SyntaxError|TypeError|ReferenceError|Uncaught Error/gu,
      )
      console.error(
        'Local proof failure categories:',
        [...new Set(diagnostics ?? [])].join(', ') || error.name,
      )
    }
    const code =
      error instanceof Error && /^WORKFORCE_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED_FAILURE'
    // eslint-disable-next-line preserve-caught-error -- Raw provider errors may include credentials; expose only the bounded stage/code.
    throw new Error(`WORKFORCE_HTTP_PROOF_FAILED:${stage}:${code}`)
  } finally {
    try {
      await local?.release()
    } finally {
      rmSync(isolated.parent, { recursive: true, force: true })
    }
  }
}

await run()
