import { fileURLToPath } from 'node:url'

import { createPage, setup, type NuxtPage } from '@nuxt/test-utils/e2e'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { afterAll, describe, expect, it } from 'vitest'

import { ensureLocalConvex } from '../helpers/local-convex'

const publicOrigin = 'http://localhost:3050'
const playgroundCwd = fileURLToPath(new URL('../../playground', import.meta.url))
const local = await ensureLocalConvex({ cwd: playgroundCwd, authOrigin: publicOrigin })
const convexUrl = local.env.NUXT_PUBLIC_CONVEX_URL
if (!convexUrl) throw new Error('Local Convex preflight did not provide NUXT_PUBLIC_CONVEX_URL')

const addNote = makeFunctionReference<'mutation', { title: string; content: string }, string>(
  'notes:add',
)
const removeNote = makeFunctionReference<'mutation', { id: string }, null>('notes:remove')

interface HydrationCase {
  name: string
  path: string
  /** Whether the SSR response already renders the query result. */
  rendersOnServer: boolean
}

// Every page renders its result into `[data-testid="data-preview"]` and its
// live status into `[data-testid="current-status"]` (QueryLab/PaginationLab).
const cases: readonly HydrationCase[] = [
  {
    name: 'useConvexQuery with SSR',
    path: '/labs/query/server-true-blocking',
    rendersOnServer: true,
  },
  {
    name: 'useConvexQuery with server: false',
    path: '/labs/query/server-false-blocking',
    rendersOnServer: false,
  },
  {
    name: 'useConvexPaginatedQuery with SSR',
    path: '/labs/pagination/server-true-blocking',
    rendersOnServer: true,
  },
  {
    name: 'useConvexPaginatedQuery with server: false',
    path: '/labs/pagination/server-false-blocking',
    rendersOnServer: false,
  },
]

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const convex = new ConvexHttpClient(convexUrl)
const createdNoteIds: string[] = []

async function createNote(title: string): Promise<void> {
  createdNoteIds.push(
    await convex.mutation(addNote, { title, content: `Hydration parity E2E note (${runId})` }),
  )
}

function renderedServerPreview(html: string): string {
  return /<pre[^>]*data-testid="data-preview"[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? ''
}

async function waitForSettledText(
  page: NuxtPage,
  text: string,
  diagnostics: () => string,
): Promise<void> {
  try {
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="current-status"]')?.textContent?.trim() ===
          'success' &&
        document.querySelector('[data-testid="data-preview"]')?.textContent?.includes(expected) ===
          true,
      text,
      // Live delivery is fast in isolation; the shared local backend is under
      // load when the whole e2e project runs.
      { timeout: 45_000 },
    )
  } catch (error) {
    const status = await page.textContent('[data-testid="current-status"]').catch(() => null)
    throw new Error(
      `"${text}" never reached a settled render (status=${JSON.stringify(status)}). ${diagnostics()}`,
      { cause: error },
    )
  }
}

describe('SSR hydration parity (full stack)', async () => {
  afterAll(async () => {
    try {
      for (const id of createdNoteIds) await convex.mutation(removeNote, { id })
    } finally {
      await local.release()
    }
  })

  await setup({
    rootDir: playgroundCwd,
    env: { ...local.env, SITE_URL: publicOrigin },
    port: 3050,
    nuxtConfig: {
      // Report the exact mismatching node instead of Vue's production summary.
      debug: { hydration: true },
      convex: {
        url: convexUrl,
        siteUrl: local.env.NUXT_PUBLIC_CONVEX_SITE_URL,
        auth: { origin: publicOrigin },
      },
    },
  })

  for (const [index, testCase] of cases.entries()) {
    it(`${testCase.name} hydrates without mismatches and becomes live`, async () => {
      // A note newer than every other row, so it is on the first page too.
      const marker = `hydration-parity-${runId}-${index}`
      const seededTitle = `${marker}-seeded`
      const liveTitle = `${marker}-live`
      await createNote(seededTitle)

      const page = await createPage()
      const hydrationMismatches: string[] = []
      const pageErrors: string[] = []
      page.on('console', (message) => {
        const text = message.text()
        if (/hydration/i.test(text) && /mismatch/i.test(text)) hydrationMismatches.push(text)
      })
      page.on('pageerror', (error) => pageErrors.push(error.message))
      const diagnostics = () =>
        `hydrationMismatches=${JSON.stringify(hydrationMismatches)} pageErrors=${JSON.stringify(pageErrors)}`

      try {
        const response = await page.goto(`${publicOrigin}${testCase.path}`, {
          waitUntil: 'hydration',
        })
        expect(response?.ok()).toBe(true)
        const html = (await response?.text()) ?? ''
        if (testCase.rendersOnServer) {
          expect(renderedServerPreview(html)).toContain(seededTitle)
        } else {
          expect(html).not.toContain(seededTitle)
        }

        await waitForSettledText(page, seededTitle, diagnostics)

        await createNote(liveTitle)
        await waitForSettledText(page, liveTitle, diagnostics)

        expect(hydrationMismatches).toEqual([])
      } finally {
        await page.close()
      }
    }, 120_000)
  }
})
