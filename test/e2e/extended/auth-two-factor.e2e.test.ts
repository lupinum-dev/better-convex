import { mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { afterAll, describe, expect, it } from 'vitest'

import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  signClientIp,
} from '../../../src/runtime/shared/client-ip'
import { assertLocalAuthReady, ensureLocalConvex } from '../../helpers/local-convex'

const fixtureCwd = fileURLToPath(new URL('../../fixtures/better-auth-two-factor', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const password = 'FixturePassword123!'
let publicOrigin = ''

type JsonRecord = Record<string, unknown>

interface PublishedJwks {
  body: Buffer
  cacheControl: string | null
  contentType: string | null
  key: JsonRecord
  status: number
}

let publishedJwks: PublishedJwks | null = null
let servedJwksResponseCount = 0

interface AuthResult {
  body: JsonRecord | JsonRecord[] | null
  clearedCookieNames: string[]
  headers: Headers
  setCookieNames: string[]
  status: number
}

interface TimelineEntry {
  clearedCookieNames: string[]
  elapsedMs: number
  setCookieNames: string[]
  status: number
  step: string
}

const mutatePersistedSession = makeFunctionReference<
  'action',
  { operation: 'delete' | 'expire' | 'mismatch'; proof: string; token: string },
  boolean
>('fixtureControl:mutatePersistedSession')
const provisionSigningKey = makeFunctionReference<
  'action',
  { proof: string },
  { activeKeyCount: number; kid: string; totalKeyCount: number }
>('fixtureControl:provisionSigningKey')
const readTwoFactorState = makeFunctionReference<
  'action',
  { proof: string; userId: string },
  { failedVerificationCount: number; lockedUntil: number }
>('fixtureControl:readTwoFactorState')
const currentIdentity = makeFunctionReference<
  'query',
  Record<string, never>,
  { sessionId: string | null; subject: string; tokenUse: string | null } | null
>('identity:current')

function responseSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const combined = headers.get('set-cookie')
  return combined ? combined.split(/,(?=\s*[^;,\s]+=)/u) : []
}

function isExpiredSetCookie(value: string): boolean {
  return /(?:^|;)\s*max-age=0(?:;|$)/iu.test(value)
}

class CookieJar {
  readonly #cookies: Map<string, string>

  constructor(cookies: ReadonlyMap<string, string> = new Map()) {
    this.#cookies = new Map(cookies)
  }

  clone(): CookieJar {
    return new CookieJar(this.#cookies)
  }

  hasSuffix(suffix: string): boolean {
    return [...this.#cookies.keys()].some((name) => name.endsWith(suffix))
  }

  header(): string | undefined {
    if (this.#cookies.size === 0) return undefined
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  apply(headers: Headers): { clearedCookieNames: string[]; setCookieNames: string[] } {
    const values = responseSetCookies(headers)
    const clearedCookieNames: string[] = []
    const setCookieNames: string[] = []
    for (const value of values) {
      const pair = value.split(';', 1)[0]
      if (!pair) continue
      const separator = pair.indexOf('=')
      if (separator <= 0) continue
      const name = pair.slice(0, separator).trim()
      const cookieValue = pair.slice(separator + 1)
      if (!cookieValue || isExpiredSetCookie(value)) {
        this.#cookies.delete(name)
        clearedCookieNames.push(name)
      } else {
        this.#cookies.set(name, cookieValue)
        setCookieNames.push(name)
      }
    }
    return { clearedCookieNames, setCookieNames }
  }
}

async function jsonBody(response: Response): Promise<AuthResult['body']> {
  const text = await response.text()
  if (!text) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (value === null || Array.isArray(value)) return value as JsonRecord[] | null
  if (typeof value !== 'object') throw new Error('Auth route returned non-object JSON')
  return value as JsonRecord
}

function recordTimeline(
  timeline: TimelineEntry[],
  startedAt: number,
  step: string,
  result: AuthResult,
): void {
  timeline.push({
    clearedCookieNames: result.clearedCookieNames,
    elapsedMs: Math.round(performance.now() - startedAt),
    setCookieNames: result.setCookieNames,
    status: result.status,
    step,
  })
}

async function requestAuth(
  siteUrl: string,
  proxyIpSecret: string,
  jar: CookieJar,
  path: string,
  options: {
    body?: JsonRecord
    clientIp: string
    method?: 'GET' | 'POST'
  },
): Promise<AuthResult> {
  const method = options.method ?? 'GET'
  const signature = await signClientIp(options.clientIp, proxyIpSecret)
  const headers = new Headers({
    [CLIENT_IP_HEADER]: options.clientIp,
    [CLIENT_IP_SIGNATURE_HEADER]: signature,
    accept: 'application/json',
    origin: publicOrigin,
  })
  const cookie = jar.header()
  if (cookie) headers.set('cookie', cookie)
  if (options.body) headers.set('content-type', 'application/json')

  const response = await fetch(`${siteUrl}/api/auth${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers,
    method,
    redirect: 'manual',
  })
  const cookieChanges = jar.apply(response.headers)
  return {
    body: await jsonBody(response),
    headers: response.headers,
    ...cookieChanges,
    status: response.status,
  }
}

function expectNoConvexJwtSideChannel(result: AuthResult): void {
  expect(result.headers.get('set-auth-jwt')).toBeNull()
  expect(result.headers.get('set-auth-token')).toBeNull()
  expect(
    [...result.setCookieNames, ...result.clearedCookieNames].some((name) =>
      /convex[_-]?jwt/iu.test(name),
    ),
  ).toBe(false)
}

function decodeBase32(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const character of value.toUpperCase().replace(/=+$/u, '')) {
    const index = alphabet.indexOf(character)
    if (index < 0) throw new Error('TOTP URI contained invalid base32')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Uint8Array.from(bytes)
}

async function currentTotp(secret: string): Promise<string> {
  const phase = Math.floor(Date.now() / 1_000) % 30
  if (phase >= 27) await new Promise((resolve) => setTimeout(resolve, (31 - phase) * 1_000))

  const counter = BigInt(Math.floor(Date.now() / 30_000))
  const message = new ArrayBuffer(8)
  new DataView(message).setBigUint64(0, counter)
  const secretBytes = decodeBase32(secret)
  const keyData = new Uint8Array(secretBytes.byteLength)
  keyData.set(secretBytes)
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer,
    { hash: 'SHA-1', name: 'HMAC' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  const offset = digest.at(-1)! & 15
  const binary =
    ((digest[offset]! & 127) << 24) |
    ((digest[offset + 1]! & 255) << 16) |
    ((digest[offset + 2]! & 255) << 8) |
    (digest[offset + 3]! & 255)
  return String(binary % 1_000_000).padStart(6, '0')
}

function requireObject(value: AuthResult['body'], label: string): JsonRecord {
  if (!value || Array.isArray(value)) throw new Error(`${label} returned an invalid body`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} was missing`)
  return value
}

async function createEnabledUser(
  siteUrl: string,
  proxyIpSecret: string,
  email: string,
  clientIp: string,
  timeline: TimelineEntry[],
  startedAt: number,
) {
  const jar = new CookieJar()
  const signUp = await requestAuth(siteUrl, proxyIpSecret, jar, '/sign-up/email', {
    body: { email, name: 'MFA Fixture User', password },
    clientIp,
    method: 'POST',
  })
  recordTimeline(timeline, startedAt, 'sign-up', signUp)
  expect(signUp.status).toBe(200)
  expect(jar.hasSuffix('session_token')).toBe(false)
  expectNoConvexJwtSideChannel(signUp)

  const signIn = await requestAuth(siteUrl, proxyIpSecret, jar, '/sign-in/email', {
    body: { email, password },
    clientIp,
    method: 'POST',
  })
  recordTimeline(timeline, startedAt, 'setup-sign-in', signIn)
  expect(signIn.status).toBe(200)
  expect(jar.hasSuffix('session_token')).toBe(true)
  expectNoConvexJwtSideChannel(signIn)

  const enabled = await requestAuth(siteUrl, proxyIpSecret, jar, '/two-factor/enable', {
    body: { method: 'totp', password },
    clientIp,
    method: 'POST',
  })
  recordTimeline(timeline, startedAt, 'enable-two-factor', enabled)
  expect(enabled.status).toBe(200)
  expectNoConvexJwtSideChannel(enabled)
  const enabledBody = requireObject(enabled.body, 'enable two-factor')
  const totpUri = new URL(requireString(enabledBody.totpURI, 'TOTP URI'))
  const secret = requireString(totpUri.searchParams.get('secret'), 'TOTP secret')

  const verified = await requestAuth(siteUrl, proxyIpSecret, jar, '/two-factor/verify-totp', {
    body: { code: await currentTotp(secret), trustDevice: false },
    clientIp,
    method: 'POST',
  })
  recordTimeline(timeline, startedAt, 'verify-two-factor-setup', verified)
  expect(verified.status).toBe(200)
  expect(jar.hasSuffix('session_token')).toBe(true)
  expect(jar.hasSuffix('session_data')).toBe(true)
  expectNoConvexJwtSideChannel(verified)
  const verifiedBody = requireObject(verified.body, 'verify two-factor setup')
  const user = requireObject(verifiedBody.user as JsonRecord, 'verified user')
  const userId = requireString(user.id, 'verified user id')

  return { email, secret, userId }
}

async function startMfaSignIn(
  siteUrl: string,
  proxyIpSecret: string,
  email: string,
  clientIp: string,
): Promise<{ challenge: AuthResult; jar: CookieJar }> {
  const jar = new CookieJar()
  const challenge = await requestAuth(siteUrl, proxyIpSecret, jar, '/sign-in/email', {
    body: { email, password },
    clientIp,
    method: 'POST',
  })
  expect(challenge.status).toBe(200)
  expect(requireObject(challenge.body, 'first factor')).toMatchObject({
    twoFactorRedirect: true,
    twoFactorMethods: ['totp'],
  })
  expect(requireObject(challenge.body, 'first factor')).not.toHaveProperty('token')
  expect(jar.hasSuffix('two_factor')).toBe(true)
  expect(jar.hasSuffix('session_token')).toBe(false)
  expect(jar.hasSuffix('session_data')).toBe(false)
  expectNoConvexJwtSideChannel(challenge)
  return { challenge, jar }
}

async function completeMfaSignIn(
  siteUrl: string,
  proxyIpSecret: string,
  user: { email: string; secret: string },
  clientIp: string,
) {
  const { challenge, jar } = await startMfaSignIn(siteUrl, proxyIpSecret, user.email, clientIp)
  const completed = await requestAuth(siteUrl, proxyIpSecret, jar, '/two-factor/verify-totp', {
    body: { code: await currentTotp(user.secret), trustDevice: false },
    clientIp,
    method: 'POST',
  })
  expect(completed.status, JSON.stringify(completed.body)).toBe(200)
  expect(jar.hasSuffix('two_factor')).toBe(false)
  expect(jar.hasSuffix('session_token')).toBe(true)
  expect(jar.hasSuffix('session_data')).toBe(true)
  expectNoConvexJwtSideChannel(completed)
  const body = requireObject(completed.body, 'final factor')
  const finalUser = requireObject(body.user as JsonRecord, 'final-factor user')
  return {
    challenge,
    completed,
    jar,
    sessionToken: requireString(body.token, 'persisted Better Auth session token'),
    userId: requireString(finalUser.id, 'final-factor user id'),
  }
}

function decodeJwtPart(token: string, index: number): JsonRecord {
  const part = token.split('.')[index]
  if (!part) throw new Error('JWT part was missing')
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as JsonRecord
}

async function waitForPublishedJwks(): Promise<PublishedJwks> {
  const deadline = Date.now() + 15_000
  while (!publishedJwks && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  if (!publishedJwks) throw new Error('MFA fixture JWKS was not published before verifier timeout')
  return publishedJwks
}

async function publishFixtureJwks(siteUrl: string, expectedKid: string): Promise<void> {
  const upstream = await fetch(`${siteUrl}/api/auth/jwks`)
  if (!upstream.ok) {
    throw new Error(`MFA fixture JWKS publication failed with status ${upstream.status}`)
  }
  const body = (await upstream.clone().json()) as { keys?: unknown }
  if (!Array.isArray(body.keys) || body.keys.length !== 1) {
    throw new Error('MFA fixture must publish exactly one provisioned signing key')
  }
  const key = body.keys[0]
  if (!key || typeof key !== 'object' || !('kid' in key) || key.kid !== expectedKid) {
    throw new Error('MFA fixture published a signing key other than the provisioned key')
  }
  publishedJwks = {
    body: Buffer.from(await upstream.arrayBuffer()),
    cacheControl: upstream.headers.get('cache-control'),
    contentType: upstream.headers.get('content-type'),
    key: key as JsonRecord,
    status: upstream.status,
  }
}

async function verifyPublishedJwtSignature(token: string): Promise<boolean> {
  if (!publishedJwks) throw new Error('MFA fixture JWKS was not published')
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) throw new Error('MFA fixture emitted an invalid JWT')
  const key = await crypto.subtle.importKey(
    'jwk',
    publishedJwks.key,
    { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    Buffer.from(signature, 'base64url'),
    new TextEncoder().encode(`${header}.${payload}`),
  )
}

async function startJwksProxy(): Promise<{ origin: string; server: Server }> {
  publishedJwks = null
  servedJwksResponseCount = 0
  const server = createServer(async (request, response) => {
    try {
      const path = request.url ? new URL(request.url, 'http://127.0.0.1').pathname : ''
      if (request.method !== 'GET' || path !== '/api/auth/jwks') {
        response.writeHead(404).end()
        return
      }
      const snapshot = await waitForPublishedJwks()
      response.statusCode = snapshot.status
      if (snapshot.cacheControl) response.setHeader('cache-control', snapshot.cacheControl)
      if (snapshot.contentType) response.setHeader('content-type', snapshot.contentType)
      servedJwksResponseCount += 1
      response.end(snapshot.body)
    } catch {
      response.writeHead(502).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('MFA fixture JWKS proxy did not bind a TCP port')
  }
  return { origin: `http://127.0.0.1:${address.port}`, server }
}

async function ensureFixturePackageLink(): Promise<void> {
  // A real backend is part of this proof, but retained ignored CLI state is
  // not. Start each transcript from a fresh component database and let the
  // CLI choose unoccupied ports when other isolated suites run concurrently.
  await removeFixtureRuntimeState()
  const fixtureNodeModules = join(fixtureCwd, 'node_modules')
  const packageScope = join(fixtureNodeModules, '@lupinum')
  const packageLink = join(packageScope, 'better-convex-nuxt')
  await mkdir(packageScope, { recursive: true })
  try {
    await symlink(repoRoot, packageLink, 'dir')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  if ((await realpath(packageLink)) !== (await realpath(repoRoot))) {
    throw new Error('MFA fixture better-convex-nuxt package link points outside the repository')
  }
}

async function removeFixtureRuntimeState(): Promise<void> {
  await Promise.all([
    rm(join(fixtureCwd, '.convex'), { force: true, recursive: true }),
    rm(join(fixtureCwd, '.env.local'), { force: true }),
    rm(join(fixtureCwd, 'node_modules', '@lupinum/better-convex-nuxt'), {
      force: true,
      recursive: true,
    }),
  ])
}

let local: Awaited<ReturnType<typeof ensureLocalConvex>> | null = null
let jwksProxy: Server | null = null
try {
  await ensureFixturePackageLink()
  const proxy = await startJwksProxy()
  jwksProxy = proxy.server
  publicOrigin = proxy.origin
  local = await ensureLocalConvex({
    authOrigin: publicOrigin,
    cwd: fixtureCwd,
    provisionSigningKey: false,
    timeoutMs: 60_000,
  })
  await assertLocalAuthReady({ cwd: fixtureCwd, env: local.env, origin: publicOrigin })
} catch (error) {
  try {
    if (jwksProxy) await new Promise<void>((resolve) => jwksProxy!.close(() => resolve()))
    await local?.release()
  } finally {
    await removeFixtureRuntimeState()
  }
  throw error
}

describe('Better Auth two-factor final-session security', () => {
  afterAll(async () => {
    try {
      if (jwksProxy) await new Promise<void>((resolve) => jwksProxy!.close(() => resolve()))
      await local?.release()
    } finally {
      await removeFixtureRuntimeState()
    }
  })

  it('mints only after the final persisted factor and preserves atomic lockout state', async () => {
    if (!local) throw new Error('Local Convex backend was not initialized')
    const siteUrl = requireString(local.env.NUXT_PUBLIC_CONVEX_SITE_URL, 'Convex site URL')
    const convexUrl = requireString(local.env.NUXT_PUBLIC_CONVEX_URL, 'Convex URL')
    const proxyIpSecret = requireString(
      process.env.BCN_AUTH_PROXY_IP_SECRET,
      'proxy IP signing secret',
    )
    const controlClient = new ConvexHttpClient(convexUrl)
    const timeline: TimelineEntry[] = []
    const startedAt = performance.now()
    const signingKey = await controlClient.action(provisionSigningKey, {
      proof: proxyIpSecret,
    })
    expect(signingKey).toMatchObject({ activeKeyCount: 1, totalKeyCount: 1 })
    await publishFixtureJwks(siteUrl, signingKey.kid)
    timeline.push({
      clearedCookieNames: [],
      elapsedMs: Math.round(performance.now() - startedAt),
      setCookieNames: [],
      status: 200,
      step: 'pre-traffic-signing-key-provisioned-and-published',
    })
    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const userA = await createEnabledUser(
      siteUrl,
      proxyIpSecret,
      `mfa-a-${unique}@example.com`,
      '198.51.100.10',
      timeline,
      startedAt,
    )
    const userB = await createEnabledUser(
      siteUrl,
      proxyIpSecret,
      `mfa-b-${unique}@example.com`,
      '198.51.100.11',
      timeline,
      startedAt,
    )

    const pending = await startMfaSignIn(siteUrl, proxyIpSecret, userA.email, '198.51.100.20')
    recordTimeline(timeline, startedAt, 'first-factor-only', pending.challenge)
    const pendingExchange = await requestAuth(
      siteUrl,
      proxyIpSecret,
      pending.jar,
      '/convex/token',
      { clientIp: '198.51.100.20' },
    )
    recordTimeline(timeline, startedAt, 'pre-mfa-convex-token', pendingExchange)
    expect(pendingExchange.status).toBe(401)
    expectNoConvexJwtSideChannel(pendingExchange)

    const [sessionA, sessionB] = await Promise.all([
      completeMfaSignIn(siteUrl, proxyIpSecret, userA, '198.51.100.21'),
      completeMfaSignIn(siteUrl, proxyIpSecret, userB, '198.51.100.22'),
    ])
    recordTimeline(timeline, startedAt, 'final-factor-a', sessionA.completed)
    recordTimeline(timeline, startedAt, 'final-factor-b', sessionB.completed)

    const [tokenAResult, tokenBResult] = await Promise.all([
      requestAuth(siteUrl, proxyIpSecret, sessionA.jar, '/convex/token', {
        clientIp: '198.51.100.21',
      }),
      requestAuth(siteUrl, proxyIpSecret, sessionB.jar, '/convex/token', {
        clientIp: '198.51.100.22',
      }),
    ])
    recordTimeline(timeline, startedAt, 'post-mfa-convex-token-a', tokenAResult)
    recordTimeline(timeline, startedAt, 'post-mfa-convex-token-b', tokenBResult)
    expect(tokenAResult.status).toBe(200)
    expect(tokenBResult.status).toBe(200)
    expect(tokenAResult.headers.get('cache-control')).toBe('private, no-store')
    expect(tokenBResult.headers.get('cache-control')).toBe('private, no-store')
    expectNoConvexJwtSideChannel(tokenAResult)
    expectNoConvexJwtSideChannel(tokenBResult)

    const tokenA = requireString(
      requireObject(tokenAResult.body, 'Convex token A').token,
      'Convex token A',
    )
    const tokenB = requireString(
      requireObject(tokenBResult.body, 'Convex token B').token,
      'Convex token B',
    )
    const claimsA = decodeJwtPart(tokenA, 1)
    const claimsB = decodeJwtPart(tokenB, 1)
    const headerA = decodeJwtPart(tokenA, 0)
    const headerB = decodeJwtPart(tokenB, 0)
    const approvedClaims = ['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'token_use']
    expect(Object.keys(claimsA).sort()).toEqual(approvedClaims)
    expect(Object.keys(claimsB).sort()).toEqual(approvedClaims)
    expect(headerA).toMatchObject({ alg: 'RS256' })
    expect(headerA.kid).toBe(signingKey.kid)
    expect(headerB.kid).toBe(signingKey.kid)
    await expect(verifyPublishedJwtSignature(tokenA)).resolves.toBe(true)
    await expect(verifyPublishedJwtSignature(tokenB)).resolves.toBe(true)
    expect(claimsA).toMatchObject({
      aud: 'convex',
      iss: siteUrl,
      sub: sessionA.userId,
      token_use: 'convex-session',
    })
    expect(claimsB).toMatchObject({
      aud: 'convex',
      iss: siteUrl,
      sub: sessionB.userId,
      token_use: 'convex-session',
    })
    expect(claimsA.sub).not.toBe(claimsB.sub)
    expect(claimsA.sid).not.toBe(claimsB.sid)
    expect((claimsA.exp as number) - (claimsA.iat as number)).toBeLessThanOrEqual(15 * 60)

    for (const [token, expected] of [
      [tokenA, claimsA],
      [tokenB, claimsB],
    ] as const) {
      const authenticatedClient = new ConvexHttpClient(convexUrl)
      authenticatedClient.setAuth(token)
      let identity: Awaited<ReturnType<typeof authenticatedClient.query>>
      try {
        identity = await authenticatedClient.query(currentIdentity, {})
      } catch (error) {
        throw new Error(
          `Convex rejected a locally verified JWT after ${servedJwksResponseCount} JWKS responses`,
          { cause: error },
        )
      }
      expect(identity).toEqual({
        sessionId: expected.sid,
        subject: expected.sub,
        tokenUse: 'convex-session',
      })
    }
    // SITE_URL remains a trusted browser origin, not JWT verification authority.
    // Convex must resolve the issuer and JWKS from its deployment-owned site URL.
    expect(servedJwksResponseCount).toBe(0)

    const genericToken = await requestAuth(siteUrl, proxyIpSecret, sessionA.jar, '/token', {
      clientIp: '198.51.100.21',
    })
    recordTimeline(timeline, startedAt, 'generic-token-disabled', genericToken)
    expect(genericToken.status).toBe(404)
    expectNoConvexJwtSideChannel(genericToken)

    const missing = await requestAuth(siteUrl, proxyIpSecret, new CookieJar(), '/convex/token', {
      clientIp: '198.51.100.30',
    })
    expect(missing.status).toBe(200)
    expect(missing.body).toEqual({ token: null })

    for (const [operation, ip] of [
      ['delete', '198.51.100.31'],
      ['expire', '198.51.100.32'],
      ['mismatch', '198.51.100.33'],
    ] as const) {
      const final = await completeMfaSignIn(siteUrl, proxyIpSecret, userB, ip)
      expect(
        await controlClient.action(mutatePersistedSession, {
          operation,
          proof: proxyIpSecret,
          token: final.sessionToken,
        }),
      ).toBe(true)
      const rejected = await requestAuth(siteUrl, proxyIpSecret, final.jar, '/convex/token', {
        clientIp: ip,
      })
      recordTimeline(timeline, startedAt, `persisted-session-${operation}`, rejected)
      expect(rejected.status).toBe(401)
      expectNoConvexJwtSideChannel(rejected)
    }

    const lockoutChallenges = await Promise.all(
      ['198.51.100.41', '198.51.100.42', '198.51.100.43'].map((clientIp) =>
        startMfaSignIn(siteUrl, proxyIpSecret, userA.email, clientIp),
      ),
    )
    const failures = await Promise.all(
      lockoutChallenges.map(({ jar }, index) =>
        requestAuth(siteUrl, proxyIpSecret, jar, '/two-factor/verify-totp', {
          body: { code: 'invalid-code', trustDevice: false },
          clientIp: `198.51.100.${41 + index}`,
          method: 'POST',
        }),
      ),
    )
    for (const [index, failure] of failures.entries()) {
      recordTimeline(timeline, startedAt, `concurrent-invalid-factor-${index + 1}`, failure)
      expect(failure.status).toBe(401)
    }
    const lockoutState = await controlClient.action(readTwoFactorState, {
      proof: proxyIpSecret,
      userId: userA.userId,
    })
    expect(lockoutState.failedVerificationCount).toBe(3)
    expect(lockoutState.lockedUntil).toBeGreaterThan(Date.now())

    const lockedChallenge = await startMfaSignIn(
      siteUrl,
      proxyIpSecret,
      userA.email,
      '198.51.100.44',
    )
    const lockedVerification = await requestAuth(
      siteUrl,
      proxyIpSecret,
      lockedChallenge.jar,
      '/two-factor/verify-totp',
      {
        body: { code: await currentTotp(userA.secret), trustDevice: false },
        clientIp: '198.51.100.44',
        method: 'POST',
      },
    )
    recordTimeline(timeline, startedAt, 'locked-correct-factor', lockedVerification)
    expect(lockedVerification.status).toBe(429)
    expect(requireObject(lockedVerification.body, 'locked verification')).toMatchObject({
      code: 'ACCOUNT_TEMPORARILY_LOCKED',
    })

    console.info(
      `AUTH_MFA_EVIDENCE ${JSON.stringify({
        claimKeys: approvedClaims,
        concurrentFailureCount: lockoutState.failedVerificationCount,
        genericTokenStatus: genericToken.status,
        lockoutEnforced: true,
        missingSessionStatus: missing.status,
        persistedSessionRejections: ['delete', 'expire', 'mismatch'],
        timeline,
      })}`,
    )
  }, 120_000)
})
