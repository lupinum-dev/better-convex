import { fileURLToPath } from 'node:url'

import { setup, createPage } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

import { ensureLocalConvex } from '../helpers/local-convex'

const publicOrigin = 'http://localhost:3050'
const local = await ensureLocalConvex({
  cwd: fileURLToPath(new URL('../../playground', import.meta.url)),
  authOrigin: publicOrigin,
})

describe('Realtime subscription (full stack)', async () => {
  afterAll(async () => {
    await local.release()
  })

  await setup({
    rootDir: fileURLToPath(new URL('../../playground', import.meta.url)),
    env: { ...local.env, SITE_URL: publicOrigin },
    port: 3050,
    nuxtConfig: {
      convex: {
        url: local.env.NUXT_PUBLIC_CONVEX_URL,
        siteUrl: local.env.NUXT_PUBLIC_CONVEX_SITE_URL,
        auth: { origin: publicOrigin },
      },
    },
  })

  it('syncs added note across tabs', async () => {
    const page1 = await createPage('/')
    const page2 = await createPage('/')
    await Promise.all([
      page1.goto(`${publicOrigin}/labs/realtime`),
      page2.goto(`${publicOrigin}/labs/realtime`),
    ])

    // Both pages must have completed their initial subscription render before we
    // mutate, so the cross-tab delivery we assert on is genuinely a live update.
    await page1.waitForSelector('[data-testid="realtime-page"]')
    await page2.waitForSelector('[data-testid="realtime-page"]')
    for (const page of [page1, page2]) {
      await page.waitForFunction(() => {
        const status = document.querySelector('[data-testid="status"]')?.textContent?.trim()
        return status === 'success' || status === 'error'
      })
      expect(await page.textContent('[data-testid="status"]')).toBe('success')
    }

    // Assert on note IDENTITY, not the absolute count: `notes.list` is
    // `.order('desc').take(50)`, so once the shared (never-reset) backend holds
    // >= 50 notes the visible count is pinned at 50 and can never increment. A
    // newly added note is the newest row, so it always appears at the TOP of the
    // list on every subscribed tab regardless of table size. We capture page2's
    // current top-note id, have page1 add a note, and require page2's live
    // subscription to surface a new top-note id.
    const topNoteId = (p: typeof page1): Promise<string | null> =>
      p
        .$eval('.notes-list .note-item:first-child', (el) => el.getAttribute('data-testid'))
        .catch(() => null)

    const beforeTopId = await topNoteId(page2)

    await page1.click('[data-testid="add-btn"]')

    await page2.waitForFunction(
      (before) => {
        const first = document.querySelector('.notes-list .note-item:first-child')
        const id = first?.getAttribute('data-testid') ?? null
        return id !== null && id !== before
      },
      beforeTopId,
      {
        // Cross-tab delivery is fast in isolation but the shared local backend is
        // under load when the whole e2e project runs; this is a wall-clock budget
        // for the same assertion, not a weaker assertion.
        timeout: 45000,
      },
    )

    const afterTopId = await topNoteId(page2)
    expect(afterTopId).toBeTruthy()
    expect(afterTopId).not.toBe(beforeTopId)
  })
})
