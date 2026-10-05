// Shared harness for the real-backend integration suite (`vitest --project=integration`).
//
// Every suite runs against the pinned local Convex backend (test/helpers/local-backend.mjs).
// `startMcpFixture` copies the MCP OAuth starter into a temporary directory, installs
// the freshly built packages, starts `convex dev` and `nuxt dev`, and creates one user.
// Everything it creates lives below one temporary root that `release()` removes.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { BrowserContext, Page } from 'playwright'

import {
  cleanLocalConvexEnvironment,
  startLocalConvexBackend,
  type LocalConvexBackend,
} from '../helpers/local-convex'

export { cleanLocalConvexEnvironment as cleanEnvironment } from '../helpers/local-convex'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const convexCli = join(root, 'node_modules/convex/bin/main.js')
const nuxtCli = join(root, 'node_modules/nuxt/bin/nuxt.mjs')
const starter = join(root, 'starters/mcp-oauth-agent')
const evidenceFunctions = join(root, 'test/fixtures/mcp-oauth-agent/evidence.ts')
const START_TIMEOUT_MS = 120_000
const MAX_LOG_BYTES = 256 * 1024

export const SCOPE = 'mcp:read mcp:write'
export const INSPECTOR_CALLBACK = 'http://localhost:6274/oauth/callback'
export const MCP_REMOTE_CALLBACK = 'http://127.0.0.1:3334/oauth/callback'
export const CONFIDENTIAL_CALLBACK = 'https://client.example.test/oauth/callback'

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

// ---------- processes ----------

export function redact(value: string, secrets: readonly string[]): string {
  let output = value
  for (const secret of secrets) if (secret) output = output.replaceAll(secret, '[REDACTED]')
  return output.replace(/(https?:\/\/[^\s?]+)\?\S+/gu, '$1?[REDACTED_QUERY]').slice(-8_000)
}

function capture(child: ChildProcess): () => string {
  let value = ''
  const append = (chunk: Buffer) => {
    value = (value + chunk.toString()).slice(-MAX_LOG_BYTES)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return () => value
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string; secrets?: readonly string[] },
): Promise<string> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
  if (options.input !== undefined) child.stdin?.end(`${options.input}\n`)
  const log = capture(child)
  const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null]
  if (code !== 0) {
    throw new Error(
      `Command failed (${code ?? signal ?? 'unknown'}): ${redact(log(), options.secrets ?? [])}`,
    )
  }
  return log().trim()
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, name)
    } catch {
      child.kill(name)
    }
  }
  signal('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise<boolean>((ready) => setTimeout(() => ready(false), 3_000)),
  ])
  if (!exited) {
    signal('SIGKILL')
    await once(child, 'exit').catch(() => {})
  }
}

/** A random free loopback port; random so concurrent fixtures do not race for the same one. */
export async function availablePort(excluded: ReadonlySet<number> = new Set()): Promise<number> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const port = randomInt(12_000, 44_000)
    if (excluded.has(port)) continue
    const server = createServer()
    const available = await new Promise<boolean>((ready) => {
      server.once('error', () => ready(false))
      server.listen(port, '127.0.0.1', () => ready(true))
    })
    if (!available) continue
    await new Promise<void>((ready) => server.close(() => ready()))
    return port
  }
  throw new Error('No free loopback port')
}

export async function waitUntil<T>(
  check: () => Promise<T | false | undefined> | T | false | undefined,
  description: string,
  timeoutMs = START_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((ready) => setTimeout(ready, 100))
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  )
}

export const sleep = (ms: number) => new Promise((ready) => setTimeout(ready, ms))

// ---------- the MCP OAuth starter fixture ----------

export interface McpFixture {
  convexSiteUrl: string
  convexUrl: string
  cwd: string
  email: string
  origin: string
  password: string
  /** `convex run <name> <args>` as the deployment operator; parses JSON output. */
  runConvex: (functionName: string, args?: JsonRecord) => Promise<unknown>
  /** Replace BETTER_AUTH_SECRETS so the current signing key can no longer be decrypted. */
  retireCurrentAuthSecret: () => Promise<void>
  readCredentialCounts: () => Promise<{
    accessTokens: number
    idTokens: number
    refreshTokens: number
  }>
  signedClientIpHeaders: (ip: string) => Promise<Record<string, string>>
  registerSecret: (secret: string) => void
  logs: () => { convex: string; nuxt: string }
  release: () => Promise<void>
}

export interface McpFixtureOptions {
  /** Trust this header as the client IP in Nuxt, as a production ingress would. */
  trustedClientIpHeader?: string
  secrets?: { betterAuthSecrets: string; proxyIpSecret: string }
  /** Runs after the starter copy exists and before Convex starts. */
  prepare?: (cwd: string) => Promise<void>
}

async function linkDependencies(cwd: string) {
  const modules = join(cwd, 'node_modules')
  await mkdir(modules, { mode: 0o700 })
  const manifests = (await Promise.all(
    [join(root, 'package.json'), join(starter, 'package.json')].map(async (path) =>
      JSON.parse(await readFile(path, 'utf8')),
    ),
  )) as Array<Record<string, Record<string, string> | undefined>>
  const [product, starterManifest] = manifests
  const names = new Set<string>()
  for (const group of [
    product?.dependencies,
    product?.optionalDependencies,
    product?.peerDependencies,
    starterManifest?.dependencies,
    starterManifest?.devDependencies,
  ]) {
    for (const name of Object.keys(group ?? {})) names.add(name)
  }
  names.delete('@lupinum/better-convex-nuxt')
  for (const name of [...names].sort()) {
    const destination = join(modules, name)
    await mkdir(dirname(destination), { mode: 0o700, recursive: true })
    await symlink(await realpath(join(root, 'node_modules', name)), destination, 'dir')
  }
  // Install the built package as a copy, the way a consumer receives it.
  const installed = join(modules, '@lupinum/better-convex-nuxt')
  await mkdir(installed, { mode: 0o700 })
  await Promise.all([
    cp(join(root, 'dist'), join(installed, 'dist'), { recursive: true }),
    cp(join(root, 'package.json'), join(installed, 'package.json')),
  ])
}

export async function startMcpFixture(options: McpFixtureOptions = {}): Promise<McpFixture> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bcn-mcp-fixture-'))
  const cwd = join(tempRoot, 'app')
  const email = `mcp-gate-${randomBytes(8).toString('hex')}@example.test`
  const password = `${randomBytes(24).toString('base64url')}!aA1`
  const betterAuthSecrets =
    options.secrets?.betterAuthSecrets ?? `1:${randomBytes(32).toString('base64url')}`
  const proxyIpSecret = options.secrets?.proxyIpSecret ?? randomBytes(32).toString('base64url')
  const secrets = [password, betterAuthSecrets, proxyIpSecret]
  let convex: LocalConvexBackend | undefined
  let nuxt: ChildProcess | undefined
  let convexLog = () => ''
  let nuxtLog = () => ''
  let released = false
  const release = async () => {
    if (released) return
    released = true
    await Promise.all([stopProcess(nuxt), convex?.release()])
    await rm(tempRoot, { force: true, recursive: true })
  }

  try {
    const skipped = new Set(['.convex', '.env.local', '.nuxt', '.output', 'node_modules'])
    await cp(starter, cwd, {
      filter: (source) => source === starter || !skipped.has(basename(source)),
      recursive: true,
    })
    await linkDependencies(cwd)
    // Operator-only test functions stay out of the starter; install them into this copy.
    await copyFile(evidenceFunctions, join(cwd, 'convex/evidence.ts'))
    const clientIp = (await import(
      pathToFileURL(
        join(cwd, 'node_modules/@lupinum/better-convex-nuxt/dist/runtime/shared/client-ip.js'),
      ).href
    )) as {
      normalizeClientIp: (ip: string) => string | null
      signClientIp: (ip: string, secret: string) => Promise<string>
    }
    await options.prepare?.(cwd)

    const ports = new Set<number>()
    for (let index = 0; index < 3; index += 1) ports.add(await availablePort(ports))
    const [cloudPort, sitePort, appPort] = [...ports] as [number, number, number]
    const convexUrl = `http://127.0.0.1:${cloudPort}`
    const convexSiteUrl = `http://127.0.0.1:${sitePort}`
    const origin = `http://127.0.0.1:${appPort}`
    const baseEnv = {
      ...cleanLocalConvexEnvironment(),
      CONVEX_AGENT_MODE: 'anonymous',
      CONVEX_ALLOW_ANONYMOUS: 'true',
    }

    convex = await startLocalConvexBackend({
      cwd,
      timeoutMs: START_TIMEOUT_MS,
      ports: { cloud: cloudPort, site: sitePort },
      devArguments: ['--tail-logs', 'disable', '--typecheck', 'disable'],
      secrets,
      logLength: MAX_LOG_BYTES,
    })
    convexLog = convex.logs
    if (convex.url !== convexUrl || convex.siteUrl !== convexSiteUrl) {
      throw new Error('Local Convex did not select the fixture ports.')
    }
    await waitUntil(
      () => fetch(`${convexUrl}/version`).then((response) => response.status < 500),
      'the local Convex backend',
    )

    const runCli = (args: string[], input?: string) =>
      runCommand(process.execPath, ['--', convexCli, ...args, '--env-file', '.env.local'], {
        cwd,
        env: baseEnv,
        input,
        secrets,
      })
    const backend = convex
    const setEnv = (name: string, value: string) => backend.setEnv(name, value, 4)
    await setEnv('SITE_URL', origin)
    await setEnv('BETTER_AUTH_SECRETS', betterAuthSecrets)
    await setEnv('BCN_AUTH_PROXY_IP_SECRET', proxyIpSecret)
    await backend.waitForFunctions()
    await runCli(['run', 'auth:rotateSigningKey', '{}'])

    const trusted = options.trustedClientIpHeader
    nuxt = spawn(process.execPath, [nuxtCli, 'dev'], {
      cwd,
      detached: true,
      env: {
        ...baseEnv,
        BCN_AUTH_PROXY_IP_SECRET: proxyIpSecret,
        ...(trusted ? { BCN_AUTH_TRUSTED_CLIENT_IP_HEADER: trusted } : {}),
        CONVEX_SITE_URL: convexSiteUrl,
        CONVEX_URL: convexUrl,
        HOST: '127.0.0.1',
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: String(appPort),
        NUXT_HOST: '127.0.0.1',
        NUXT_PORT: String(appPort),
        NUXT_PUBLIC_CONVEX_SITE_URL: convexSiteUrl,
        NUXT_PUBLIC_CONVEX_URL: convexUrl,
        PORT: String(appPort),
        SITE_URL: origin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    nuxtLog = capture(nuxt)
    await waitUntil(async () => {
      if (nuxt?.exitCode !== null) throw new Error(`Nuxt exited: ${redact(nuxtLog(), secrets)}`)
      return fetch(origin, { redirect: 'manual' }).then((response) => response.status === 200)
    }, 'the Nuxt MCP starter')

    const signUp = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({ email, name: 'MCP Gate', password }),
      headers: {
        'content-type': 'application/json',
        origin,
        ...(trusted ? { [trusted]: '127.0.0.1' } : {}),
      },
      method: 'POST',
      redirect: 'manual',
    })
    await signUp.body?.cancel().catch(() => {})
    if (signUp.status !== 200) throw new Error(`Fixture user creation failed with ${signUp.status}`)

    const runConvex = async (functionName: string, args: JsonRecord = {}) => {
      const output = await runCli(['run', functionName, JSON.stringify(args)])
      try {
        return JSON.parse(output) as unknown
      } catch {
        return output
      }
    }

    return Object.freeze({
      convexSiteUrl,
      convexUrl,
      cwd,
      email,
      origin,
      password,
      runConvex,
      retireCurrentAuthSecret: async () => {
        const replacement = `2:${randomBytes(32).toString('base64url')}`
        secrets.push(replacement)
        await setEnv('BETTER_AUTH_SECRETS', replacement)
      },
      readCredentialCounts: async () => {
        const counts = await runConvex('evidence:countCredentialRows')
        const valid = (value: unknown): value is number =>
          Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100
        if (
          !isRecord(counts) ||
          !valid(counts.accessTokens) ||
          !valid(counts.idTokens) ||
          !valid(counts.refreshTokens)
        ) {
          throw new Error('OAUTH_CODE_TOKEN_COUNTS_INVALID')
        }
        return {
          accessTokens: counts.accessTokens,
          idTokens: counts.idTokens,
          refreshTokens: counts.refreshTokens,
        }
      },
      signedClientIpHeaders: async (ip: string) => {
        const canonical = clientIp.normalizeClientIp(ip)
        if (!canonical) throw new Error('Invalid fixture client IP')
        return {
          'x-bcn-client-ip': canonical,
          'x-bcn-client-ip-signature': await clientIp.signClientIp(canonical, proxyIpSecret),
        }
      },
      registerSecret: (secret: string) => {
        if (!secrets.includes(secret)) secrets.push(secret)
      },
      logs: () => ({ convex: redact(convexLog(), secrets), nuxt: redact(nuxtLog(), secrets) }),
      release,
    })
  } catch (error) {
    console.error(`[mcp-fixture] Convex output: ${redact(convexLog(), secrets)}`)
    console.error(`[mcp-fixture] Nuxt output: ${redact(nuxtLog(), secrets)}`)
    await release()
    throw error
  }
}

/** Operator-provisioned OAuth clients for the fixture user (never over HTTP). */
export async function provisionClients(fixture: McpFixture) {
  const profile = await fixture.runConvex('evidence:provision', { email: fixture.email })
  if (!isRecord(profile) || !isRecord(profile.clients)) throw new Error('Invalid OAuth profile')
  return {
    inspector: String(profile.clients.inspector),
    mcpRemote: String(profile.clients.mcpRemote),
    organizationId: String(profile.organizationId),
    resource: String(profile.resource),
  }
}

export async function signIn(context: BrowserContext, fixture: McpFixture): Promise<void> {
  const response = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    data: { email: fixture.email, password: fixture.password },
    headers: { origin: fixture.origin },
  })
  if (!response.ok()) throw new Error(`Fixture sign-in failed with ${response.status()}`)
}

// ---------- OAuth ----------

export interface AuthorizationGrant {
  code: string
  verifier: string
}

/**
 * Drive the real authorization endpoint, login and consent pages in a browser
 * until the provider redirects to `redirectUri`, then check the callback binding.
 * The callback is answered by a route stub, so no local callback server is needed.
 */
export async function authorizeInBrowser(
  page: Page,
  fixture: Pick<McpFixture, 'email' | 'origin' | 'password'>,
  request: { clientId: string; redirectUri: string; resource: string; scope?: string },
): Promise<AuthorizationGrant> {
  const verifier = randomBytes(48).toString('base64url')
  const state = randomBytes(24).toString('base64url')
  const callback = new URL(request.redirectUri)
  await page.route(
    (url) => url.origin === callback.origin && url.pathname === callback.pathname,
    (route) =>
      route.fulfill({
        body: 'OAuth callback received.',
        contentType: 'text/plain; charset=utf-8',
        headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
        status: 200,
      }),
  )
  const authorize = new URL(`${fixture.origin}/api/auth/oauth2/authorize`)
  authorize.search = new URLSearchParams({
    client_id: request.clientId,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'consent',
    redirect_uri: request.redirectUri,
    resource: request.resource,
    response_type: 'code',
    scope: request.scope ?? SCOPE,
    state,
  }).toString()
  try {
    await page.goto(authorize.href, { waitUntil: 'domcontentloaded' })
    const deadline = Date.now() + 60_000
    let signedIn = false
    let approved = false
    while (Date.now() < deadline) {
      const current = new URL(page.url())
      if (current.origin === callback.origin && current.pathname === callback.pathname) {
        const params = current.searchParams
        const failure = params.get('error')
        if (failure) throw new Error(`Authorization failed with ${failure}`)
        if (params.getAll('code').length !== 1) throw new Error('OAUTH_CALLBACK_CODE_INVALID')
        if (params.getAll('state').length !== 1 || params.get('state') !== state) {
          throw new Error('OAUTH_CALLBACK_STATE_MISMATCH')
        }
        if (
          params.getAll('iss').length !== 1 ||
          params.get('iss') !== `${fixture.origin}/api/auth`
        ) {
          throw new Error('OAUTH_CALLBACK_ISSUER_MISMATCH')
        }
        const code = params.get('code')!
        if (code.length < 16 || code.length > 512) throw new Error('OAUTH_CALLBACK_CODE_INVALID')
        return { code, verifier }
      }
      if (current.origin !== fixture.origin) throw new Error('OAUTH_BROWSER_ORIGIN_ESCAPE')
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
      if (
        await page
          .getByRole('alert')
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        throw new Error('OAUTH_BROWSER_AUTHORIZATION_FAILED')
      }
      await page.waitForTimeout(100)
    }
    throw new Error('OAUTH_BROWSER_AUTHORIZATION_TIMEOUT')
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
}

export interface TokenResult {
  body: unknown
  /** The response carries no access, refresh, or ID token and no JWT-shaped value. */
  credentialFree: boolean
  error?: string
  status: number
}

const COMPACT_JWT = /(?:^|\s|")[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}(?:$|\s|")/u

export async function redeemCode(
  origin: string,
  body: Record<string, string>,
  authorization?: string,
): Promise<TokenResult> {
  const response = await fetch(`${origin}/api/auth/oauth2/token`, {
    body: new URLSearchParams(body),
    headers: {
      ...(authorization ? { authorization } : {}),
      'content-type': 'application/x-www-form-urlencoded',
      origin,
    },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const credentialFields = isRecord(parsed)
    ? ['access_token', 'refresh_token', 'id_token'].filter((field) => parsed[field] !== undefined)
    : []
  return {
    body: parsed,
    credentialFree:
      credentialFields.length === 0 &&
      !COMPACT_JWT.test(text) &&
      !/(?:access_token|refresh_token|id_token)\s*[=:]/iu.test(isRecord(parsed) ? '' : text),
    // A non-JSON 5xx body counts as server_error; a JSON body must name its error.
    error: isRecord(parsed)
      ? typeof parsed.error === 'string'
        ? parsed.error
        : undefined
      : response.status >= 500
        ? 'server_error'
        : undefined,
    status: response.status,
  }
}

export function decodeJwtPart(token: string, index: 0 | 1): JsonRecord {
  const part = token.split('.')[index]
  const value = part
    ? (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown)
    : null
  if (!isRecord(value)) throw new Error('Not a compact JWT')
  return value
}

/** Every binding a provider-issued MCP access token must carry; returns the names that fail. */
export function accessTokenProblems(
  token: unknown,
  expected: { clientId: string; origin: string; resource: string; scope?: string },
): string[] {
  if (typeof token !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token)) return ['compact']
  let header: JsonRecord
  let claims: JsonRecord
  try {
    header = decodeJwtPart(token, 0)
    claims = decodeJwtPart(token, 1)
  } catch {
    return ['decode']
  }
  const now = Math.floor(Date.now() / 1000)
  const iat = claims.iat as number
  const exp = claims.exp as number
  const checks: Record<string, boolean> = {
    algorithm: header.alg === 'RS256',
    type: header.typ === 'at+jwt',
    claims:
      JSON.stringify(Object.keys(claims).sort()) ===
      JSON.stringify([
        'aud',
        'azp',
        'bcn_grant_id',
        'client_id',
        'exp',
        'iat',
        'iss',
        'jti',
        'scope',
        'sid',
        'sub',
        'token_use',
      ]),
    issuer: claims.iss === `${expected.origin}/api/auth`,
    audience: claims.aud === expected.resource,
    client: claims.client_id === expected.clientId && claims.azp === expected.clientId,
    // Every MCP access token is bound to its consent row.
    grant: typeof claims.bcn_grant_id === 'string' && claims.bcn_grant_id.length > 0,
    scope: claims.scope === (expected.scope ?? SCOPE),
    tokenClass: claims.token_use === 'oauth-access',
    subject: typeof claims.sub === 'string' && claims.sub.length > 0,
    session: typeof claims.sid === 'string' && claims.sid.length > 0,
    noDpop: claims.cnf === undefined,
    current:
      Number.isSafeInteger(iat) &&
      Number.isSafeInteger(exp) &&
      iat <= now + 60 &&
      exp > now &&
      exp - iat <= 600,
  }
  return Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)
}

/** Problems with a successful authorization-code token response: exactly one short-lived bound access token. */
export function tokenResponseProblems(
  result: TokenResult,
  expected: { clientId: string; origin: string; resource: string },
): string[] {
  const body = isRecord(result.body) ? result.body : {}
  const problems = accessTokenProblems(body.access_token, expected)
  if (result.status !== 200) problems.push(`status ${result.status}`)
  if (body.refresh_token !== undefined || body.id_token !== undefined) problems.push('extra token')
  if (body.token_type !== 'Bearer') problems.push('token_type')
  if (body.scope !== SCOPE) problems.push('scope')
  const expiresIn = body.expires_in as number
  if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0 || expiresIn > 600)
    problems.push('expires_in')
  return problems
}

/** The browser keeps no OAuth credential in web storage or cookies, and no cache or IndexedDB at all. */
export async function browserCredentialLeaks(page: Page, context: BrowserContext, origin: string) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  const storage = await page.evaluate(async () => ({
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
  const jwt = (value: unknown) => COMPACT_JWT.test(JSON.stringify(value).replaceAll('\\"', ' '))
  return {
    storageJwt: jwt(storage),
    storageCredential: [...storage.local, ...storage.session].some(
      ([name, value]) => credentialName.test(name) || credentialName.test(value),
    ),
    storageContainers: storage.cacheNames.length + storage.indexedDbNames.length,
    cookieJwt: jwt(state),
    credentialCookie: state.cookies.some((cookie) => credentialName.test(cookie.name)),
  }
}
