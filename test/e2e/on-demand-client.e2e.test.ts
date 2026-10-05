import { createServer, type IncomingMessage, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'

import { createPage, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `client.connect: 'on-demand'` and route-level SSR auth, through the real
 * module (`test/fixtures/on-demand-client`). One local HTTP mock stands in for
 * the Convex deployment (WebSocket upgrades) and its site URL (Better Auth),
 * and records every request it receives.
 */

const MOCK_PORT = 4989
const NUXT_PORT = 4612
const SESSION_COOKIE = 'better-auth.session_token=on-demand-fixture-session'

interface Recorded {
  readonly kind: 'http' | 'upgrade'
  readonly path: string
}

describe('on-demand browser runtime and SSR auth route rules', async () => {
  const recorded: Recorded[] = []
  let mock: Server
  const record = (kind: Recorded['kind'], request: IncomingMessage) =>
    recorded.push({ kind, path: request.url ?? '' })

  beforeAll(async () => {
    mock = createServer((request, response) => {
      record('http', request)
      // Better Auth reads the session (none) and the SSR exchange gets no token.
      response.writeHead(request.url?.startsWith('/api/auth/get-session') ? 200 : 401, {
        'content-type': 'application/json',
      })
      response.end('null')
    })
    mock.on('upgrade', (request, socket) => {
      record('upgrade', request)
      socket.destroy()
    })
    await new Promise<void>((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => mock.close(() => resolve()))
  })

  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/on-demand-client', import.meta.url)),
    port: NUXT_PORT,
    browser: true,
    env: {
      ON_DEMAND_MOCK_ORIGIN: `http://127.0.0.1:${MOCK_PORT}`,
      ON_DEMAND_SITE_ORIGIN: `http://127.0.0.1:${NUXT_PORT}`,
    },
  })

  it('renders a ssrAuth: false route without reading the session or varying on cookies', async () => {
    recorded.length = 0
    const response = await fetch('/', { headers: { cookie: SESSION_COOKIE } })
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('data-testid="status">anonymous<')
    expect(response.headers.get('vary') ?? '').not.toMatch(/cookie/iu)
    expect(response.headers.get('cache-control') ?? '').not.toContain('private')
    expect(recorded).toEqual([])
  })

  it('still resolves the session on routes without the rule', async () => {
    recorded.length = 0
    const response = await fetch('/ssr-session', { headers: { cookie: SESSION_COOKIE } })

    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toMatch(/cookie/iu)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(recorded.map((entry) => entry.path)).toContain('/api/auth/convex/token')
  })

  it('loads no Convex or Better Auth client until activate() runs', async () => {
    const page = await createPage()
    const sockets: string[] = []
    const authRequests: string[] = []
    page.on('websocket', (socket) => sockets.push(socket.url()))
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/auth')) authRequests.push(request.url())
    })

    await page.goto(url('/'), { waitUntil: 'networkidle' })
    expect(await page.getByTestId('connect').textContent()).toBe('on-demand')
    expect(await page.getByTestId('active').textContent()).toBe('false')
    expect(sockets).toEqual([])
    expect(authRequests).toEqual([])

    await page.getByTestId('activate').click()
    await page.getByTestId('active').filter({ hasText: 'true' }).waitFor()
    await expect.poll(() => sockets.length).toBeGreaterThan(0)
    expect(sockets.every((socket) => socket.startsWith(`ws://127.0.0.1:${MOCK_PORT}/`))).toBe(true)
    await expect.poll(() => authRequests.length).toBeGreaterThan(0)
    await page.close()
  })

  it('activates on navigation to a protected page and applies the redirect', async () => {
    const page = await createPage()
    const sockets: string[] = []
    page.on('websocket', (socket) => sockets.push(socket.url()))

    await page.goto(url('/sign-in'), { waitUntil: 'networkidle' })
    expect(sockets).toEqual([])

    await page.getByTestId('account-link').click()
    await page.waitForURL(/\/sign-in\?redirect=/u)
    await expect.poll(() => sockets.length).toBeGreaterThan(0)
    await page.close()
  })
})
