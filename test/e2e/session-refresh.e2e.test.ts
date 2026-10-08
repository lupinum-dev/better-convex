import { fileURLToPath } from 'node:url'

import { setup, createPage } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

import {
  assertLocalAuthReady,
  ensureLocalConvex,
  readLocalConvexEnv,
  spawnConvex,
} from '../helpers/local-convex'

/**
 * A sliding session renewal must pass unnoticed: Better Auth extends a session
 * past its update age on the next request, and both the browser's Convex token
 * refresh and an SSR reload must keep the user signed in with a renewed cookie.
 */

const playgroundCwd = fileURLToPath(new URL('../../playground', import.meta.url))
const origin = 'http://localhost:3050'
const sessionCookieName = 'better-auth.session_token'

interface StoredSession {
  id: string
  expiresAt: number
  updatedAt: number
}

let local: Awaited<ReturnType<typeof ensureLocalConvex>> | null = null
try {
  local = await ensureLocalConvex({ cwd: playgroundCwd })
  await assertLocalAuthReady({ cwd: playgroundCwd, env: local.env, origin })
} catch (error) {
  await local?.release()
  throw error
}

/** Run a test-only playground function as the local deployment's admin. */
async function runSessionFunction(name: string, email: string): Promise<StoredSession> {
  const { deployment } = await readLocalConvexEnv(playgroundCwd)
  if (!deployment) throw new Error('The local Convex deployment selection is missing.')
  const child = spawnConvex(
    playgroundCwd,
    ['run', `e2eSessions:${name}`, JSON.stringify({ email }), '--typecheck', 'disable'],
    {},
    deployment,
  )
  child.stdin.end()
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += String(chunk)))
  child.stderr.on('data', (chunk) => (stderr += String(chunk)))
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve))
  if (code !== 0) throw new Error(`e2eSessions:${name} failed: ${stderr}`)
  return JSON.parse(stdout) as StoredSession
}

describe('Sliding session renewal (full stack)', async () => {
  afterAll(async () => {
    await local?.release()
  })

  await setup({
    rootDir: playgroundCwd,
    env: local ? { ...local.env, SITE_URL: origin } : undefined,
    port: 3050,
    nuxtConfig: local
      ? {
          convex: {
            url: local.env.NUXT_PUBLIC_CONVEX_URL,
            siteUrl: local.env.NUXT_PUBLIC_CONVEX_SITE_URL,
            auth: { origin },
          },
        }
      : undefined,
  })

  it('keeps the protected query and renews the cookie across SSR and token refresh', async () => {
    const page = await createPage()
    // The page clock flows normally; the test moves it only to reach the token refresh timer.
    await page.clock.install()
    const email = `e2e+refresh-${Date.now()}@example.com`

    await page.goto(`${origin}/auth/signup`)
    await page.fill('#name', 'E2E Refresh')
    await page.fill('#email', email)
    await page.fill('#password', 'Password123456!')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/auth/signin', { timeout: 15_000 })
    await page.fill('#email', email)
    await page.fill('#password', 'Password123456!')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${origin}/`, { timeout: 15_000 })

    await page.goto(`${origin}/demo/dashboard`)
    const authId = page.locator('.info-item:has-text("Auth ID") .value')
    await authId.waitFor({ timeout: 30_000 })
    const profileId = (await authId.textContent())?.trim()
    expect(profileId).toBeTruthy()

    const browserCookie = async () =>
      (await page.context().cookies()).find((cookie) => cookie.name === sessionCookieName)

    // SSR reload: the server's token exchange renews the session.
    const agedForSsr = await runSessionFunction('ageSession', email)
    const reload = await page.reload()
    if (!reload) throw new Error('Expected a document response')
    const html = await reload.text()
    expect(html).toContain('Your Profile')
    expect(html).not.toContain('You need to sign in to view this page.')
    const documentCookies = (await reload.headersArray()).filter(
      (header) => header.name.toLowerCase() === 'set-cookie',
    )
    expect(documentCookies.some((header) => header.value.startsWith(`${sessionCookieName}=`))).toBe(
      true,
    )
    const renewedBySsr = await runSessionFunction('readSession', email)
    expect(renewedBySsr.id).toBe(agedForSsr.id)
    expect(renewedBySsr.expiresAt).toBeGreaterThan(agedForSsr.expiresAt)
    const ssrCookie = await browserCookie()
    expect(Math.abs(ssrCookie!.expires * 1_000 - renewedBySsr.expiresAt)).toBeLessThan(5_000)
    await authId.waitFor({ timeout: 30_000 })
    expect((await authId.textContent())?.trim()).toBe(profileId)

    // Browser token refresh: the Convex client's scheduled refetch renews the session.
    await runSessionFunction('ageSession', email)
    await page.evaluate(() => {
      const breaks: string[] = []
      ;(window as unknown as { __sessionBreaks: string[] }).__sessionBreaks = breaks
      new MutationObserver(() => {
        if (document.querySelector('.not-auth')) breaks.push('not-auth')
        if (!document.querySelector('.content .info-grid')) breaks.push('profile-hidden')
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    const tokenResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/convex/token',
      { timeout: 30_000 },
    )
    await page.clock.fastForward('15:00')
    expect((await tokenResponse).status()).toBe(200)
    // Let Convex authenticate the new token and answer the live query again.
    await page.waitForTimeout(2_000)

    expect(
      await page.evaluate(
        () => (window as unknown as { __sessionBreaks: string[] }).__sessionBreaks,
      ),
    ).toEqual([])
    expect((await authId.textContent())?.trim()).toBe(profileId)
    expect(await page.textContent('body')).not.toContain('rejected the authentication token')
    const renewedByRefresh = await runSessionFunction('readSession', email)
    expect(renewedByRefresh.expiresAt).toBeGreaterThan(renewedBySsr.expiresAt)
    const refreshCookie = await browserCookie()
    expect(Math.abs(refreshCookie!.expires * 1_000 - renewedByRefresh.expiresAt)).toBeLessThan(
      5_000,
    )
  })
})
