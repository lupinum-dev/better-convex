import { fileURLToPath } from 'node:url'

import { setup, createPage } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

import { ensureLocalConvex } from '../helpers/local-convex'

const local = await ensureLocalConvex({
  cwd: fileURLToPath(new URL('../../playground', import.meta.url)),
})

describe('Connection state (full stack)', async () => {
  afterAll(async () => {
    await local.release()
  })

  await setup({
    rootDir: fileURLToPath(new URL('../../playground', import.meta.url)),
    env: local.env,
    nuxtConfig: {
      convex: {
        url: local.env.NUXT_PUBLIC_CONVEX_URL,
        siteUrl: local.env.NUXT_PUBLIC_CONVEX_SITE_URL,
      },
    },
  })

  it('renders connection telemetry with expected state shape', async () => {
    const page = await createPage('/')
    await page.waitForLoadState('networkidle')
    const hydrationDiagnostics: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      const text = message.text()
      if (/hydration.*mismatch/i.test(text)) {
        hydrationDiagnostics.push(text)
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`${new URL(page.url()).origin}/labs/connection`)
    try {
      await page.waitForSelector('.raw-state pre', { timeout: 15000 })
    } catch (error) {
      throw new Error(
        `Connection lab did not render. pageErrors=${JSON.stringify(pageErrors)} body=${JSON.stringify((await page.textContent('body'))?.slice(0, 1000))}`,
        { cause: error },
      )
    }

    const heading = await page.textContent('.container h1')
    expect(heading).toContain('Connection Lab')

    const webSocketConnected = await page.textContent(
      '.stat:has(.label:text("WebSocket Connected")) .value',
    )
    expect(webSocketConnected).toMatch(/Yes|No/)

    const rawState = await page.textContent('.raw-state pre')
    const parsed = JSON.parse(rawState || '{}')
    expect(parsed).toHaveProperty('hasInflightRequests')
    expect(parsed).toHaveProperty('isWebSocketConnected')
    expect(parsed).toHaveProperty('connectionRetries')
    expect(hydrationDiagnostics).toEqual([])
  })
})
