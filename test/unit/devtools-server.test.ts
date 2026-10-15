import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { eventResponseHeaders } from '../../src/runtime/server/utils/event'
import { inDevelopment } from '../helpers/dev-mode'
import { webServerEvent } from '../helpers/server-event'

const outputDir = mkdtempSync(join(tmpdir(), 'bcn-devtools-'))
vi.mock('nuxt/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuxt/server')>()),
  useRuntimeConfig: () => ({
    convexDevtoolsPath: outputDir,
    app: {},
    public: {},
  }),
}))

const { default: handler } = await import('../../src/runtime/devtools/server')
const { recordAuthProxyRequest } = await import('../../src/runtime/devtools/auth-proxy-registry')

function devtoolsEvent(path: string) {
  const event = webServerEvent({}, `http://localhost:3000/__convex_devtools__${path}`)
  return { event: event as Parameters<typeof handler>[0], headers: eventResponseHeaders(event) }
}

describe('devtools server handler', () => {
  // Wrong behaviour caught: a production build serving the devtools UI or the
  // auth proxy stats (request paths, statuses) to anyone who asks.
  it.each(['/', '/index.html', '/proxy-stats', '../secret.txt'])(
    'answers %s with a 404 outside development',
    async (path) => {
      const { event, headers } = devtoolsEvent(path)
      await expect(handler(event)).rejects.toMatchObject({ status: 404 })
      expect([...headers.keys()]).toEqual([])
    },
  )

  // Wrong behaviour caught: the stats endpoint answering without its JSON type
  // or with a cacheable response, so the devtools panel shows stale or no data.
  it('serves the recorded auth proxy requests as uncached JSON in development', async () => {
    await recordAuthProxyRequest({
      id: 'r1',
      path: '/api/auth/get-session',
      method: 'GET',
      timestamp: 1,
      status: 200,
      duration: 12,
      success: true,
    })
    const { event, headers } = devtoolsEvent('/proxy-stats')

    const body = await inDevelopment(() => handler(event))

    expect(JSON.parse(String(body))).toMatchObject({
      totalRequests: 1,
      recentRequests: [{ id: 'r1', path: '/api/auth/get-session', status: 200 }],
    })
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('cache-control')).toBe('no-cache')
  })

  // Wrong behaviour caught: a path that climbs out of the devtools output
  // directory reading any file the server process can read.
  // `/__convex_devtools__../secret.txt` keeps its `..` through URL parsing
  // (it is part of the first segment), and the prefix strip leaves
  // `../secret.txt`.
  it('refuses a path outside the devtools output directory in development', async () => {
    const { event, headers } = devtoolsEvent('../secret.txt')

    await expect(inDevelopment(() => handler(event))).rejects.toMatchObject({ status: 403 })
    expect([...headers.keys()]).toEqual([])
  })
})
