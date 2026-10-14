import { request as createHttpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'

import { $fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'

import { ensureLocalConvex } from '../helpers/local-convex'

const local = await ensureLocalConvex({
  cwd: fileURLToPath(new URL('../../playground', import.meta.url)),
})

const fetchUnknown = $fetch as (
  request: string,
  options?: { method?: string; body?: unknown },
) => Promise<unknown>

async function postChunked(path: string, chunks: string[]) {
  const target = new URL(path, url('/'))
  return await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const request = createHttpRequest(
      target,
      {
        method: 'POST',
        headers: {
          connection: 'close',
          'content-type': 'application/json',
        },
      },
      (response) => {
        const responseChunks: Buffer[] = []
        response.on('data', (chunk) => {
          responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.once('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(responseChunks).toString('utf8'),
          })
        })
      },
    )
    request.once('error', reject)
    for (const chunk of chunks) request.write(chunk)
    request.end()
  })
}

describe('Server caller smoke (serverConvex query/mutation)', async () => {
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

  it('round-trips through Nitro API endpoints backed by server fetch helpers', async () => {
    const queryResponse = (await fetchUnknown('/api/test-server-query?limit=1')) as {
      success: boolean
      count: number
      totalAvailable: number
      notes: unknown[]
      executedOn: string
      message?: string
      error?: string
    }

    expect(queryResponse.success, JSON.stringify(queryResponse)).toBe(true)
    expect(queryResponse.executedOn).toBe('server')
    expect(Array.isArray(queryResponse.notes)).toBe(true)
    expect(queryResponse.count).toBeLessThanOrEqual(1)

    const uniqueTitle = `Server smoke ${Date.now()}`
    const mutationResponse = (await fetchUnknown('/api/test-server-mutation', {
      method: 'POST',
      body: {
        title: uniqueTitle,
        content: 'Created by server-utils-smoke.e2e.test.ts',
      },
    })) as {
      success: boolean
      noteId?: string
      meta?: { title?: string; executedOn?: string }
      message?: string
      error?: string
    }

    expect(mutationResponse.success, JSON.stringify(mutationResponse)).toBe(true)
    expect(mutationResponse.noteId).toBeTruthy()
    expect(mutationResponse.meta?.title).toBe(uniqueTitle)
    expect(mutationResponse.meta?.executedOn).toBe('server')
  })

  it('rejects malformed or excessive query limits at the HTTP boundary', async () => {
    const invalidQueries = [
      'limit=0',
      'limit=-1',
      'limit=1.5',
      'limit=51',
      'limit=Infinity',
      'limit=1&limit=2',
    ]

    for (const query of invalidQueries) {
      const response = await fetch(url(`/api/test-server-query?${query}`))
      expect(response.status, query).toBe(400)
      const body = (await response.json()) as {
        message?: string
        statusMessage?: string
        statusText?: string
        url?: string
      }
      // Nuxt 4 (h3 v1) names the reason `statusMessage`; Nuxt 5 names it `statusText`.
      const statusText = body.statusMessage ?? body.statusText
      expect(statusText, query).toBe('limit must be an integer from 1 to 50')
      expect(body.message, query).toBe('limit must be an integer from 1 to 50')
      // The error envelope may include the request URL. The two diagnostic
      // fields must stay constant instead of reflecting input or a
      // Convex/backend error.
      expect(statusText, query).not.toContain(query)
      expect(body.message, query).not.toContain(query)
    }
  })

  it('rejects an oversized anonymous chunked mutation body before parsing or Convex access', async () => {
    const response = await postChunked('/api/test-server-mutation', [
      '{"content":"',
      'x'.repeat(6 * 1024),
      'x'.repeat(6 * 1024),
      '"}',
    ])

    expect(response.statusCode).toBe(413)
    expect(response.body).not.toContain('x'.repeat(100))
  })
})
