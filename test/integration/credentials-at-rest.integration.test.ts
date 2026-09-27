// Credentials at rest, on the MCP starter: after a full browser auth lifecycle
// (SSR, hydration, revocation, sign-out) and an OAuth flow, a real Convex
// snapshot export must not contain any raw secret, token, code or verifier.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  authorizeInBrowser,
  cleanEnvironment,
  convexCli,
  INSPECTOR_CALLBACK,
  isRecord,
  provisionClients,
  redeemCode,
  runCommand,
  signIn,
  startMcpFixture,
  tokenResponseProblems,
  type McpFixture,
} from './harness'

const runId = `bcn-${randomUUID()}`

/** The same derivation the in-deployment seeding action uses. */
function canary(id: string) {
  const digest = createHash('sha256').update(`better-convex-nuxt\0${runId}\0${id}`).digest('hex')
  return `BCN_SENTINEL_${id.replaceAll('-', '_').toUpperCase()}_${digest}`
}

// Stored tables that hold credentials, and the rows this run must have put there,
// so the scan cannot pass on an empty export.
const credentialTables = {
  account: 2,
  jwks: 1,
  oauthAccessToken: 0,
  oauthClient: 3,
  verification: 1,
}

const seedAction = `
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

/** A social account with provider tokens and a JWK with a private member, stored the production way. */
export const seedEncryptedCredentials = action({
  args: {},
  handler: async (ctx) => {
    const auth = await createAuth(ctx)
    const context = await auth.$context
    const users = await context.adapter.findMany({ model: 'user', limit: 2 })
    if (users.length !== 1 || typeof users[0]?.id !== 'string') throw new Error('SEED_USER_INVALID')
    const now = new Date()
    await context.adapter.create({
      model: 'account',
      data: {
        id: crypto.randomUUID(),
        accountId: 'credentials-at-rest-provider-account',
        providerId: 'credentials-at-rest-provider',
        userId: users[0].id,
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
    if (!key || typeof key.id !== 'string') throw new Error('SEED_JWK_MISSING')
    const privateKey = JSON.stringify(
      await symmetricEncrypt({
        data: JSON.stringify({ d: await sentinel('private-jwk-member'), kty: 'RSA' }),
        key: context.secretConfig,
      }),
    )
    await context.adapter.update({ model: 'jwks', where: [{ field: 'id', value: key.id }], update: { privateKey } })
    return 'SEEDED'
  },
})
`

const lifecyclePage = `<script setup lang="ts">
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
`

const protectedPage = `<script setup lang="ts">
definePageMeta({ convexAuth: true })
</script>

<template><p data-testid="protected-content">Protected content</p></template>
`

/** Every encoding a leaked value could take in a file. */
function encodings(value: string) {
  return new Set([
    value,
    encodeURIComponent(value),
    Buffer.from(value).toString('base64'),
    Buffer.from(value).toString('base64url'),
  ])
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('credentials at rest on the MCP starter', () => {
  const secrets: Record<string, string> = {
    'better-auth-current-secret': canary('better-auth-current-secret'),
    'better-auth-prior-secret': canary('better-auth-prior-secret'),
    'proxy-ip-secret': canary('proxy-ip-secret'),
    'social-access-token': canary('social-access-token'),
    'social-refresh-token': canary('social-refresh-token'),
    'social-id-token': canary('social-id-token'),
    'private-jwk-member': canary('private-jwk-member'),
  }
  let fixture: McpFixture
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let scratch: string

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'bcn-credentials-at-rest-'))
    fixture = await startMcpFixture({
      secrets: {
        betterAuthSecrets: `2:${secrets['better-auth-current-secret']},1:${secrets['better-auth-prior-secret']}`,
        proxyIpSecret: secrets['proxy-ip-secret']!,
      },
      prepare: async (cwd) => {
        await writeFile(path.join(cwd, 'convex/credentialsAtRest.ts'), seedAction)
        await writeFile(path.join(cwd, 'app/pages/lifecycle.vue'), lifecyclePage)
        await writeFile(path.join(cwd, 'app/pages/protected-probe.vue'), protectedPage)
      },
    })
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { height: 900, width: 1_440 } })
    page = await context.newPage()
  })

  afterAll(async () => {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await fixture?.release()
    if (scratch) await rm(scratch, { force: true, recursive: true })
  })

  const text = async (testId: string, predicate: (value: string) => boolean, code: string) => {
    const deadline = Date.now() + 30_000
    let value = ''
    while (Date.now() < deadline) {
      value = (
        (await page
          .getByTestId(testId)
          .textContent()
          .catch(() => '')) ?? ''
      ).trim()
      if (predicate(value)) return value
      await page.waitForTimeout(50)
    }
    throw new Error(`${code}: ${value.slice(0, 64) || 'missing'}`)
  }
  const convexToken = () =>
    context.request.get(`${fixture.origin}/api/auth/convex/token`, {
      headers: { origin: fixture.origin },
    })

  it('bootstraps anonymously with a null Convex token', async () => {
    const response = await convexToken()
    expect(response.status(), 'AUTH_EXPORT_ANONYMOUS_BOOTSTRAP_FAILED').toBe(200)
    expect(await response.json(), 'AUTH_EXPORT_ANONYMOUS_BOOTSTRAP_INVALID').toStrictEqual({
      token: null,
    })
  })

  it('renders, hydrates, refreshes and guards an authenticated session', async () => {
    await signIn(context, fixture)
    const token = await convexToken()
    expect(token.ok(), 'AUTH_EXPORT_CONVEX_TOKEN_FAILED').toBe(true)
    const jwt = ((await token.json()) as { token?: unknown }).token
    expect(
      typeof jwt === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(jwt),
      'AUTH_EXPORT_CONVEX_TOKEN_INVALID',
    ).toBe(true)
    secrets['convex-session-jwt'] = jwt as string

    const ssr = await context.request.get(`${fixture.origin}/lifecycle`)
    expect(ssr.status(), 'AUTH_EXPORT_AUTHENTICATED_SSR_FAILED').toBe(200)
    expect(ssr.headers()['cache-control'], 'AUTH_EXPORT_AUTHENTICATED_SSR_CACHE_INVALID').toBe(
      'private, no-store',
    )
    const html = await ssr.text()
    expect(
      html.includes('data-testid="auth-status"') && html.includes('authenticated'),
      'AUTH_EXPORT_AUTHENTICATED_SSR_IDENTITY_MISSING',
    ).toBe(true)

    await page.goto(`${fixture.origin}/lifecycle`, { waitUntil: 'domcontentloaded' })
    await text('hydrated', (value) => value === 'ready', 'AUTH_EXPORT_HYDRATION')
    expect(await text('auth-status', Boolean, 'AUTH_EXPORT_AUTHENTICATED_HYDRATION_FAILED')).toBe(
      'authenticated',
    )
    await page.getByTestId('refresh').click()
    await text('auth-pending', (value) => value === 'false', 'AUTH_EXPORT_REFRESH_SETTLEMENT')
    expect(await text('auth-status', Boolean, 'AUTH_EXPORT_AUTHENTICATED_REFRESH_FAILED')).toBe(
      'authenticated',
    )

    await page.goto(`${fixture.origin}/protected-probe`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('protected-content').waitFor()
    expect(new URL(page.url()).pathname, 'AUTH_EXPORT_GUARD_FAILED').toBe('/protected-probe')
  })

  it('rejects a session revoked from another browser and guards with a return path', async () => {
    const current = await context.request.get(`${fixture.origin}/api/auth/get-session`)
    expect(current.ok(), 'AUTH_EXPORT_GET_SESSION_FAILED').toBe(true)
    const session = (await current.json()) as { session?: { token?: unknown } }
    expect(typeof session.session?.token, 'AUTH_EXPORT_SESSION_TOKEN_INVALID').toBe('string')
    const administrator = await browser.newContext()
    try {
      await signIn(administrator, fixture)
      const revoked = await administrator.request.post(
        `${fixture.origin}/api/auth/revoke-session`,
        {
          data: { token: session.session!.token },
          headers: { origin: fixture.origin },
        },
      )
      expect(revoked.ok(), 'AUTH_EXPORT_SESSION_REVOCATION_FAILED').toBe(true)
    } finally {
      await administrator.close()
    }
    expect(
      (await context.request.get(`${fixture.origin}/api/auth/convex/token`)).status(),
      'AUTH_EXPORT_REVOKED_SESSION_ACCEPTED',
    ).toBe(401)
    await page.goto(`${fixture.origin}/lifecycle`, { waitUntil: 'domcontentloaded' })
    await text(
      'auth-status',
      (value) => value !== '' && value !== 'authenticated',
      'AUTH_EXPORT_REVOKED_SESSION_STATE',
    )
    await page.goto(`${fixture.origin}/protected-probe?reason=revoked`, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForURL((url) => url.pathname === '/auth/signin')
    expect(
      new URL(page.url()).searchParams.get('redirect'),
      'AUTH_EXPORT_REVOKED_GUARD_RETURN_INVALID',
    ).toBe('/protected-probe?reason=revoked')
  })

  it('issues an OAuth code and access token, then signs out to anonymous', async () => {
    await signIn(context, fixture)
    const clients = await provisionClients(fixture)
    expect(clients.resource, 'AUTH_EXPORT_OAUTH_PROFILE_INVALID').toBe(
      `${fixture.convexSiteUrl}/mcp`,
    )
    const confidential = await fixture.runConvex('evidence:provisionConfidential')
    const clientSecret =
      isRecord(confidential) && isRecord(confidential.client)
        ? confidential.client.secret
        : undefined
    expect(typeof clientSecret, 'AUTH_EXPORT_CONFIDENTIAL_SECRET_INVALID').toBe('string')
    secrets['oauth-client-secret'] = clientSecret as string
    fixture.registerSecret(clientSecret as string)

    const request = {
      clientId: clients.inspector,
      redirectUri: INSPECTOR_CALLBACK,
      resource: clients.resource,
    }
    // One code stays unredeemed, so it is live in storage during the export.
    const pending = await authorizeInBrowser(page, fixture, request)
    secrets['authorization-code'] = pending.code
    secrets['pkce-code-verifier'] = pending.verifier
    const redeemable = await authorizeInBrowser(page, fixture, request)
    const token = await redeemCode(fixture.origin, {
      client_id: clients.inspector,
      code: redeemable.code,
      code_verifier: redeemable.verifier,
      grant_type: 'authorization_code',
      redirect_uri: INSPECTOR_CALLBACK,
      resource: clients.resource,
    })
    expect(
      tokenResponseProblems(token, {
        clientId: clients.inspector,
        origin: fixture.origin,
        resource: clients.resource,
      }),
      'AUTH_EXPORT_OAUTH_TOKEN_RESPONSE_INVALID',
    ).toEqual([])
    secrets['oauth-access-token'] = (token.body as { access_token: string }).access_token

    const signedOut = await context.request.post(`${fixture.origin}/api/auth/sign-out`, {
      data: {},
      headers: { origin: fixture.origin },
    })
    expect(signedOut.ok(), 'AUTH_EXPORT_SIGN_OUT_REQUEST_FAILED').toBe(true)
    await page.goto(`${fixture.origin}/lifecycle`, { waitUntil: 'domcontentloaded' })
    await text('auth-status', (value) => value === 'anonymous', 'AUTH_EXPORT_SIGN_OUT_STATE')
    const after = await context.request.get(`${fixture.origin}/api/auth/convex/token`)
    expect(after.status(), 'AUTH_EXPORT_SIGN_OUT_TOKEN_STATUS_INVALID').toBe(200)
    expect(
      ((await after.json()) as { token?: unknown }).token,
      'AUTH_EXPORT_SIGN_OUT_TOKEN_INVALID',
    ).toBeNull()
  })

  it('exports a snapshot that contains no raw credential in any encoding', async () => {
    // Passwords are stored as hashes only.
    secrets['user-password'] = fixture.password
    expect(Object.keys(secrets)).toHaveLength(13)
    // `convex run` prints function logs before the result.
    expect(
      String(await fixture.runConvex('credentialsAtRest:seedEncryptedCredentials')),
      'AUTH_EXPORT_SENTINEL_SEED_INVALID',
    ).toMatch(/"SEEDED"$/u)
    const archive = path.join(scratch, 'snapshot.zip')
    const env = cleanEnvironment()
    const output = [
      await runCommand(
        process.execPath,
        ['--', convexCli, 'export', '--path', archive, '--env-file', '.env.local'],
        {
          cwd: fixture.cwd,
          env,
        },
      ),
    ]
    const extracted = path.join(scratch, 'extracted')
    output.push(await runCommand('unzip', ['-qq', archive, '-d', extracted], { cwd: scratch, env }))

    const files = await listFiles(extracted)
    const relative = files.map((file) => path.relative(extracted, file).split(path.sep).join('/'))
    const rows: Record<string, number> = {}
    for (const [index, file] of relative.entries()) {
      const parts = file.split('/')
      const table = Object.keys(credentialTables).find((name) => parts.includes(name))
      if (!table || parts.at(-1) !== 'documents.jsonl') continue
      const lines = (await readFile(files[index]!, 'utf8')).split(/\r?\n/u).filter(Boolean)
      for (const line of lines)
        expect(isRecord(JSON.parse(line)), 'AUTH_EXPORT_COMPONENT_ROW_INVALID').toBe(true)
      rows[table] = (rows[table] ?? 0) + lines.length
    }
    for (const [table, minimum] of Object.entries(credentialTables)) {
      expect(rows[table], `AUTH_EXPORT_COMPONENT_TABLE_MISSING:${table}`).toBeDefined()
      expect(rows[table]!, `AUTH_EXPORT_COMPONENT_ROW_MISSING:${table}`).toBeGreaterThanOrEqual(
        minimum,
      )
    }

    const surfaces = [
      { name: 'archive', bytes: await readFile(archive) },
      { name: 'cli output', bytes: Buffer.from(output.join('\n')) },
      ...(await Promise.all(
        files.map(async (file, index) => ({ name: relative[index]!, bytes: await readFile(file) })),
      )),
    ]
    const leaks: string[] = []
    for (const surface of surfaces) {
      for (const [id, value] of Object.entries(secrets)) {
        for (const encoded of encodings(value)) {
          // Report the class and location only; never the value.
          if (surface.bytes.includes(Buffer.from(encoded))) leaks.push(`${id} in ${surface.name}`)
        }
      }
    }
    expect(leaks, 'AUTH_SECRET_SENTINEL_LEAK').toEqual([])
  })
})
