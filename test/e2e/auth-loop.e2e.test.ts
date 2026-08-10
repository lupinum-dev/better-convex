import { fileURLToPath } from 'node:url'

import { setup, createPage } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

import { assertLocalAuthReady, ensureLocalConvex } from '../helpers/local-convex'

const playgroundCwd = fileURLToPath(new URL('../../playground', import.meta.url))

async function waitForPathOrFormError(
  page: Awaited<ReturnType<typeof createPage>>,
  pathname: string,
  timeout: number,
): Promise<void> {
  await Promise.race([
    page.waitForURL((url) => new URL(url).pathname === pathname, { timeout }),
    page.waitForSelector('.error', { state: 'visible', timeout }).then(async () => {
      const message = (await page.textContent('.error'))?.trim() || 'unknown form error'
      throw new Error(`Authentication form failed: ${message}`)
    }),
  ])
}

let local: Awaited<ReturnType<typeof ensureLocalConvex>> | null = null
try {
  local = await ensureLocalConvex({
    cwd: playgroundCwd,
  })

  await assertLocalAuthReady({
    cwd: playgroundCwd,
    env: local.env,
    origin: 'http://localhost:3050',
  })
} catch (error) {
  await local?.release()
  throw error
}

describe('Auth loop (full stack)', async () => {
  afterAll(async () => {
    if (local) {
      await local.release()
    }
  })

  await setup({
    rootDir: playgroundCwd,
    env: local ? { ...local.env, SITE_URL: 'http://localhost:3050' } : undefined,
    port: 3050,
    nuxtConfig: local
      ? {
          convex: {
            url: local.env.NUXT_PUBLIC_CONVEX_URL,
            siteUrl: local.env.NUXT_PUBLIC_CONVEX_SITE_URL,
            auth: { origin: 'http://localhost:3050' },
          },
        }
      : undefined,
  })

  it('completes signup -> sign-in -> authenticated dashboard -> signout -> protected redirect', async () => {
    const page = await createPage('/')
    await page.goto('http://localhost:3050/auth/signup')

    const uniqueEmail = `e2e+${Date.now()}@example.com`

    await page.fill('#name', 'E2E User')
    await page.fill('#email', uniqueEmail)
    await page.fill('#password', 'Password123456!')
    const signUpResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/auth/sign-up/email'),
    )
    await page.click('button[type="submit"]')
    const signUpResult = await signUpResponse
    if (!signUpResult.ok()) {
      const body = (await signUpResult.text()).replace(/\s+/g, ' ').trim().slice(0, 500)
      throw new Error(`Sign-up returned ${signUpResult.status()}: ${body || '(empty body)'}`)
    }

    await waitForPathOrFormError(page, '/auth/signin', 15_000)
    await page.fill('#email', uniqueEmail)
    await page.fill('#password', 'Password123456!')
    await page.click('button[type="submit"]')
    await waitForPathOrFormError(page, '/', 15_000)

    const postSignInCookies = await page.context().cookies()
    const sessionAfterSignIn = postSignInCookies.find(
      (cookie) =>
        cookie.name === 'better-auth.session_token' ||
        cookie.name === '__Secure-better-auth.session_token',
    )

    if (!sessionAfterSignIn) {
      const signInError = await page.textContent('.error').catch(() => null)
      throw new Error(`Sign-in did not establish a session${signInError ? `: ${signInError}` : ''}`)
    }
    expect(sessionAfterSignIn).toMatchObject({
      domain: 'localhost',
      httpOnly: true,
      name: 'better-auth.session_token',
      path: '/',
      sameSite: 'Lax',
      secure: false,
    })

    await page.goto('http://localhost:3050/demo/dashboard')
    await page.waitForSelector('h2:has-text("Your Profile")', { timeout: 30_000 })

    const cookies = await page.context().cookies()
    const hasSessionCookie = cookies.some(
      (cookie) =>
        cookie.name === 'better-auth.session_token' ||
        cookie.name === '__Secure-better-auth.session_token',
    )
    expect(hasSessionCookie).toBe(true)

    await page.click('button.btn-signout')
    await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 30_000 })

    const postSignoutCookies = await page.context().cookies()
    expect(
      postSignoutCookies.some(
        (cookie) =>
          cookie.name === 'better-auth.session_token' ||
          cookie.name === '__Secure-better-auth.session_token',
      ),
    ).toBe(false)

    await page.goto('http://localhost:3050/labs/guard-protected')
    await page.waitForURL(/\/auth\/signin/, { timeout: 15_000 })

    const redirectUrl = new URL(page.url())
    expect(redirectUrl.pathname).toBe('/auth/signin')
    expect(redirectUrl.searchParams.get('redirect')).toBe('/labs/guard-protected')
  })
})
