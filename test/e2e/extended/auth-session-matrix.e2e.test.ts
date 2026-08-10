import { fileURLToPath } from 'node:url'

import { setup } from '@nuxt/test-utils/e2e'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { chromium, type APIRequestContext, type Browser, type Page } from 'playwright'
import { afterAll, describe, expect, it } from 'vitest'

import { assertLocalAuthReady, ensureLocalConvex } from '../../helpers/local-convex'

const playgroundCwd = fileURLToPath(new URL('../../../playground', import.meta.url))
const local = await ensureLocalConvex({ cwd: playgroundCwd })
await assertLocalAuthReady({ cwd: playgroundCwd, env: local.env, origin: 'http://localhost:3050' })
const convexUrl = local.env.NUXT_PUBLIC_CONVEX_URL
if (!convexUrl) throw new Error('Local Convex preflight did not provide NUXT_PUBLIC_CONVEX_URL')

const getPermissionContext = makeFunctionReference<
  'query',
  Record<string, never>,
  { role: string; userId: string }
>('auth:getPermissionContext')

// Simulate the normalized post-ingress value with one address per isolated
// browser context so Better Auth's production per-IP limits do not couple
// otherwise independent scenarios. Dedicated proxy security tests prove that
// the real boundary strips, authenticates, and forwards this header safely.
const testClientIpHeader = 'x-e2e-client-ip'
let nextTestClientIp = 1

function createIsolatedBrowserContext(browser: Browser) {
  const clientIp = `192.0.2.${nextTestClientIp}`
  nextTestClientIp += 1
  return browser.newContext({ extraHTTPHeaders: { [testClientIpHeader]: clientIp } })
}

async function registerAndSignIn(page: Page, email: string) {
  await page.goto('http://localhost:3050/auth/signup')
  await page.fill('#name', 'Security Matrix User')
  await page.fill('#email', email)
  await page.fill('#password', 'Password123456!')
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => new URL(url).pathname === '/auth/signin', {
    timeout: 15_000,
  })
  await page.fill('#email', email)
  await page.fill('#password', 'Password123456!')
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 15_000 })
}

async function signIn(page: Page, email: string) {
  await page.goto('http://localhost:3050/auth/signin')
  await page.fill('#email', email)
  await page.fill('#password', 'Password123456!')
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 15_000 })
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
}

const pollOptions = { interval: 100, timeout: 15_000 }

async function expectAuthenticatedIdentity(page: Page): Promise<string> {
  await expect.poll(() => page.getByTestId('auth-state').textContent(), pollOptions).toBe('true')
  await expect
    .poll(async () => {
      const sessionUserId = await page.getByTestId('session-user-id').textContent()
      const convexSubject = await page.getByTestId('convex-auth-subject').textContent()
      return sessionUserId !== 'none' && sessionUserId === convexSubject
    }, pollOptions)
    .toBe(true)

  return (await page.getByTestId('session-user-id').textContent())!
}

async function expectAnonymousIdentity(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('auth-state').textContent(), pollOptions).toBe('false')
  await expect.poll(() => page.getByTestId('auth-email').textContent(), pollOptions).toBe('none')
  await expect
    .poll(() => page.getByTestId('session-user-id').textContent(), pollOptions)
    .toBe('none')
  await expect
    .poll(() => page.getByTestId('convex-auth-subject').textContent(), pollOptions)
    .toBe('none')
}

async function readSsrResponse(request: APIRequestContext) {
  const response = await request.get('http://localhost:3050/labs/use-auth-test')
  return {
    body: await response.text(),
    headers: response.headers(),
    status: response.status(),
  }
}

describe('canonical Better Auth session matrix', async () => {
  afterAll(async () => local.release())

  await setup({
    rootDir: playgroundCwd,
    env: { ...local.env, SITE_URL: 'http://localhost:3050' },
    port: 3050,
    nuxtConfig: {
      convex: {
        url: convexUrl,
        siteUrl: local.env.NUXT_PUBLIC_CONVEX_SITE_URL,
        auth: {
          origin: 'http://localhost:3050',
          trustedClientIpHeader: testClientIpHeader,
        },
      },
      routeRules: {
        '/labs/use-auth-test': {
          headers: {
            'cache-control': 'public, s-maxage=86400',
            'cdn-cache-control': 'public, s-maxage=86400',
            'surrogate-control': 'max-age=86400',
            'vercel-cdn-cache-control': 'public, s-maxage=86400',
          },
        },
      },
    },
  })

  it('propagates raw Better Auth logout across tabs and clears Convex identity', async () => {
    const browser = await chromium.launch()
    const context = await createIsolatedBrowserContext(browser)
    const page = await context.newPage()
    const secondPage = await context.newPage()

    try {
      await registerAndSignIn(page, `raw-logout-${Date.now()}@example.com`)
      await page.goto('http://localhost:3050/labs/use-auth-test')
      await secondPage.goto('http://localhost:3050/labs/use-auth-test')
      const firstIdentity = await expectAuthenticatedIdentity(page)
      expect(await expectAuthenticatedIdentity(secondPage)).toBe(firstIdentity)

      await page.getByTestId('raw-signout').click()
      await expectAnonymousIdentity(page)
      await expectAnonymousIdentity(secondPage)
    } finally {
      await browser.close()
    }
  })

  it('replaces the prior account identity after logout and a second registration', async () => {
    const browser = await chromium.launch()
    const context = await createIsolatedBrowserContext(browser)
    const page = await context.newPage()
    const secondPage = await context.newPage()

    try {
      const firstEmail = `switch-a-${Date.now()}@example.com`
      const secondEmail = `switch-b-${Date.now()}@example.com`
      await registerAndSignIn(page, firstEmail)
      await page.goto('http://localhost:3050/labs/use-auth-test')
      await secondPage.goto('http://localhost:3050/labs/use-auth-test')
      await expect
        .poll(() => page.getByTestId('auth-email').textContent(), pollOptions)
        .toBe(firstEmail)
      const firstIdentity = await expectAuthenticatedIdentity(page)
      expect(await expectAuthenticatedIdentity(secondPage)).toBe(firstIdentity)

      await secondPage.getByTestId('raw-signout').click()
      await expectAnonymousIdentity(page)
      await expectAnonymousIdentity(secondPage)

      await registerAndSignIn(secondPage, secondEmail)
      await secondPage.goto('http://localhost:3050/labs/use-auth-test')
      await expect
        .poll(() => secondPage.getByTestId('auth-email').textContent(), pollOptions)
        .toBe(secondEmail)
      // Sign-in does not promise a cross-tab refetch event. Reload the other
      // page so it consumes the new account from this context's shared cookie.
      await page.reload()
      await expect
        .poll(() => page.getByTestId('auth-email').textContent(), pollOptions)
        .toBe(secondEmail)
      const secondIdentity = await expectAuthenticatedIdentity(secondPage)
      expect(await expectAuthenticatedIdentity(page)).toBe(secondIdentity)
      expect(secondIdentity).not.toBe(firstIdentity)
    } finally {
      await browser.close()
    }
  })

  it('isolates sequential and concurrent SSR payloads and defeats shared-cache route headers', async () => {
    const browser = await chromium.launch()
    const contextA = await createIsolatedBrowserContext(browser)
    const contextB = await createIsolatedBrowserContext(browser)
    const anonymousContext = await createIsolatedBrowserContext(browser)
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      const emailA = `ssr-isolation-a-${Date.now()}@example.com`
      const emailB = `ssr-isolation-b-${Date.now()}@example.com`
      await registerAndSignIn(pageA, emailA)
      await registerAndSignIn(pageB, emailB)

      const cookieA = (await contextA.cookies()).find((cookie) =>
        cookie.name.endsWith('session_token'),
      )
      const cookieB = (await contextB.cookies()).find((cookie) =>
        cookie.name.endsWith('session_token'),
      )
      expect(cookieA?.value).toBeTruthy()
      expect(cookieB?.value).toBeTruthy()
      expect(cookieA?.value).not.toBe(cookieB?.value)

      const assertAuthenticatedResponse = (
        response: Awaited<ReturnType<typeof readSsrResponse>>,
        ownEmail: string,
        otherEmail: string,
        cookieValue: string,
      ) => {
        expect(response.status).toBe(200)
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(response.headers.vary?.toLowerCase().split(/\s*,\s*/)).toContain('cookie')
        expect(response.headers['cdn-cache-control']).toBeUndefined()
        expect(response.headers['surrogate-control']).toBeUndefined()
        expect(response.headers['vercel-cdn-cache-control']).toBeUndefined()
        expect(response.body).toContain(ownEmail)
        expect(response.body).not.toContain(otherEmail)
        expect(response.body).not.toContain(cookieValue)
      }

      const sequentialA = await readSsrResponse(contextA.request)
      const sequentialB = await readSsrResponse(contextB.request)
      const sequentialAnonymous = await readSsrResponse(anonymousContext.request)
      assertAuthenticatedResponse(sequentialA, emailA, emailB, cookieA!.value)
      assertAuthenticatedResponse(sequentialB, emailB, emailA, cookieB!.value)
      expect(sequentialAnonymous.status).toBe(200)
      expect(sequentialAnonymous.headers.vary?.toLowerCase().split(/\s*,\s*/)).toContain('cookie')
      expect(sequentialAnonymous.body).not.toContain(emailA)
      expect(sequentialAnonymous.body).not.toContain(emailB)
      expect(sequentialAnonymous.body).not.toContain(cookieA!.value)
      expect(sequentialAnonymous.body).not.toContain(cookieB!.value)

      const [concurrentA, concurrentB, concurrentAnonymous] = await Promise.all([
        readSsrResponse(contextA.request),
        readSsrResponse(contextB.request),
        readSsrResponse(anonymousContext.request),
      ])
      assertAuthenticatedResponse(concurrentA, emailA, emailB, cookieA!.value)
      assertAuthenticatedResponse(concurrentB, emailB, emailA, cookieB!.value)
      expect(concurrentAnonymous.body).not.toContain(emailA)
      expect(concurrentAnonymous.body).not.toContain(emailB)
      expect(concurrentAnonymous.body).not.toContain(cookieA!.value)
      expect(concurrentAnonymous.body).not.toContain(cookieB!.value)
    } finally {
      await browser.close()
    }
  })

  it('rejects public session bearer exchange while an issued Convex JWT remains replayable only until exp', async () => {
    const browser = await chromium.launch()
    const contextA = await createIsolatedBrowserContext(browser)
    const contextB = await createIsolatedBrowserContext(browser)
    const bearerContext = await createIsolatedBrowserContext(browser)
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      const email = `session-revocation-${Date.now()}@example.com`
      await registerAndSignIn(pageA, email)
      await pageA.goto('http://localhost:3050/labs/use-auth-test')
      const userId = await expectAuthenticatedIdentity(pageA)

      const sessionsBefore = await contextA.request.get(
        'http://localhost:3050/api/auth/list-sessions',
      )
      expect(sessionsBefore.status()).toBe(200)
      const firstSessions = (await sessionsBefore.json()) as Array<{ token?: unknown }>
      expect(firstSessions).toHaveLength(1)
      expect(typeof firstSessions[0]?.token).toBe('string')
      const sessionTokenA = firstSessions[0]!.token as string

      const rawBearerBeforeRevocation = await bearerContext.request.get(
        'http://localhost:3050/api/auth/convex/token',
        { headers: { authorization: `Bearer ${sessionTokenA}` } },
      )
      expect(rawBearerBeforeRevocation.status()).toBe(401)

      const tokenResponseA = await contextA.request.get(
        'http://localhost:3050/api/auth/convex/token',
      )
      expect(tokenResponseA.status()).toBe(200)
      const convexTokenA = ((await tokenResponseA.json()) as { token: string }).token
      const claimsA = decodeJwtPayload(convexTokenA)
      expect(claimsA.sub).toBe(userId)
      expect(typeof claimsA.iat).toBe('number')
      expect(typeof claimsA.exp).toBe('number')
      // Session JWTs stay within the supported 15-minute replay ceiling after
      // the backing Better Auth session is removed.
      expect((claimsA.exp as number) - (claimsA.iat as number)).toBeGreaterThan(0)
      expect((claimsA.exp as number) - (claimsA.iat as number)).toBeLessThanOrEqual(15 * 60)

      await signIn(pageB, email)
      await pageB.goto('http://localhost:3050/labs/use-auth-test')
      expect(await expectAuthenticatedIdentity(pageB)).toBe(userId)

      const revokeA = await contextB.request.post('http://localhost:3050/api/auth/revoke-session', {
        data: { token: sessionTokenA },
        headers: { origin: 'http://localhost:3050' },
      })
      expect(revokeA.status()).toBe(200)
      expect(await revokeA.json()).toEqual({ status: true })

      const rejectedExchangeA = await contextA.request.get(
        'http://localhost:3050/api/auth/convex/token',
      )
      expect(rejectedExchangeA.status()).toBe(401)
      const rawBearerAfterRevocation = await bearerContext.request.get(
        'http://localhost:3050/api/auth/convex/token',
        { headers: { authorization: `Bearer ${sessionTokenA}` } },
      )
      expect(rawBearerAfterRevocation.status()).toBe(401)

      const replayClientA = new ConvexHttpClient(convexUrl)
      replayClientA.setAuth(convexTokenA)
      await expect(replayClientA.query(getPermissionContext, {})).resolves.toEqual({
        role: 'member',
        userId,
      })

      await pageA.reload()
      await expectAnonymousIdentity(pageA)
      // Revoking A must not disturb B's separate active session.
      await pageB.reload()
      expect(await expectAuthenticatedIdentity(pageB)).toBe(userId)

      const tokenResponseB = await contextB.request.get(
        'http://localhost:3050/api/auth/convex/token',
      )
      expect(tokenResponseB.status()).toBe(200)
      const convexTokenB = ((await tokenResponseB.json()) as { token: string }).token

      const revokeAll = await contextB.request.post(
        'http://localhost:3050/api/auth/revoke-sessions',
        {
          data: {},
          headers: { origin: 'http://localhost:3050' },
        },
      )
      expect(revokeAll.status()).toBe(200)
      expect(await revokeAll.json()).toEqual({ status: true })
      const rejectedExchangeB = await contextB.request.get(
        'http://localhost:3050/api/auth/convex/token',
      )
      expect(rejectedExchangeB.status()).toBe(401)

      const replayClientB = new ConvexHttpClient(convexUrl)
      replayClientB.setAuth(convexTokenB)
      await expect(replayClientB.query(getPermissionContext, {})).resolves.toEqual({
        role: 'member',
        userId,
      })
      await pageB.reload()
      await expectAnonymousIdentity(pageB)
    } finally {
      await browser.close()
    }
  })
})
