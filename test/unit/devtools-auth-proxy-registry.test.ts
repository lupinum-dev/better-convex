import { inspect } from 'node:util'

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('devtools auth proxy registry', () => {
  beforeEach(() => {
    // The registry keeps its list in module memory; a fresh module per test.
    vi.resetModules()
  })

  it('records and aggregates request stats in module memory', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')

    await registry.recordAuthProxyRequest({
      id: '1',
      path: '/convex/token',
      method: 'GET',
      timestamp: Date.now(),
      duration: 40,
      status: 200,
      success: true,
    })
    await registry.recordAuthProxyRequest({
      id: '2',
      path: '/get-session',
      method: 'GET',
      timestamp: Date.now(),
      duration: 80,
      status: 500,
      success: false,
    })

    const stats = await registry.getAuthProxyStats()
    expect(stats.totalRequests).toBe(2)
    expect(stats.successCount).toBe(1)
    expect(stats.errorCount).toBe(1)
    expect(stats.avgDuration).toBe(40)
    expect(stats.recentRequests.map((r) => r.id)).toEqual(['2', '1'])
  })

  it('counts a 302 as redirected rather than failed', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')
    await registry.recordAuthProxyRequest({
      id: 'redirect',
      path: '/oauth/authorize',
      method: 'GET',
      timestamp: 0,
      status: 302,
      success: false,
    })
    const stats = await registry.getAuthProxyStats()
    expect(stats).toMatchObject({
      totalRequests: 1,
      successCount: 0,
      errorCount: 0,
    })
  })

  it('persists only reviewed fields and drops raw error diagnostics', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')
    const sentinels = {
      message: 'DEVTOOLS_AUTH_MESSAGE_SENTINEL_29d3ad',
      cause: 'DEVTOOLS_AUTH_CAUSE_SENTINEL_145b9f',
      stack: 'DEVTOOLS_AUTH_STACK_SENTINEL_7dfb84',
    }
    const rawError = new Error(sentinels.message, {
      cause: new Error(sentinels.cause),
    })
    rawError.stack = sentinels.stack

    await registry.recordAuthProxyRequest({
      id: 'sentinel',
      path: '/convex/token',
      method: 'GET',
      timestamp: 1,
      status: 502,
      success: false,
      error: rawError,
      cause: rawError.cause,
      stack: rawError.stack,
    } as never)

    const stats = await registry.getAuthProxyStats()
    const rendered = inspect(stats, { depth: null })
    expect(stats.recentRequests).toEqual([
      {
        id: 'sentinel',
        path: '/convex/token',
        method: 'GET',
        timestamp: 1,
        status: 502,
        success: false,
      },
    ])
    for (const sentinel of Object.values(sentinels)) expect(rendered).not.toContain(sentinel)
  })

  // Wrong behaviour caught: the in-memory list growing without bound in a
  // long-running dev server, or keeping the oldest entries instead of the newest.
  it('keeps only the 20 newest requests', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')
    for (let i = 0; i < 25; i++) {
      await registry.recordAuthProxyRequest({
        id: String(i),
        path: '/get-session',
        method: 'GET',
        timestamp: i,
        status: 200,
        success: true,
      })
    }
    const stats = await registry.getAuthProxyStats()
    expect(stats.totalRequests).toBe(20)
    expect(stats.recentRequests[0]?.id).toBe('24')
    expect(stats.recentRequests.at(-1)?.id).toBe('5')
  })

  // Wrong behaviour caught: handing out the live array, so a caller can edit the
  // stored history.
  it('returns a copy of the history', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')
    await registry.recordAuthProxyRequest({
      id: 'a',
      path: '/p',
      method: 'GET',
      timestamp: 1,
    })
    ;(await registry.getAuthProxyStats()).recentRequests.length = 0
    expect((await registry.getAuthProxyStats()).totalRequests).toBe(1)
  })
})
