import { inspect } from 'node:util'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type StorageMap = Map<string, unknown>
const backingStore: StorageMap = new Map()

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({
    async getItem<T>(key: string): Promise<T | null> {
      return (backingStore.get(key) as T | undefined) ?? null
    },
    async setItem(key: string, value: unknown) {
      backingStore.set(key, value)
    },
  }),
}))

describe('devtools auth proxy registry', () => {
  beforeEach(() => {
    backingStore.clear()
  })

  it('records and aggregates request stats using Nitro storage', async () => {
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

  it('persists only reviewed fields and drops raw error diagnostics', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')
    const sentinels = {
      message: 'DEVTOOLS_AUTH_MESSAGE_SENTINEL_29d3ad',
      cause: 'DEVTOOLS_AUTH_CAUSE_SENTINEL_145b9f',
      stack: 'DEVTOOLS_AUTH_STACK_SENTINEL_7dfb84',
    }
    const rawError = new Error(sentinels.message, { cause: new Error(sentinels.cause) })
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

  it('clears stored stats', async () => {
    const registry = await import('../../src/runtime/devtools/auth-proxy-registry')
    await registry.recordAuthProxyRequest({
      id: '1',
      path: '/convex/token',
      method: 'GET',
      timestamp: Date.now(),
      success: true,
    })
    await registry.clearAuthProxyStats()

    const stats = await registry.getAuthProxyStats()
    expect(stats.totalRequests).toBe(0)
    expect(stats.recentRequests).toEqual([])
  })
})
