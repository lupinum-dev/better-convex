import { inspect } from 'node:util'

import { describe, expect, it, vi } from 'vitest'

import {
  fetchConvexToken,
  MAX_FETCH_ATTEMPTS,
  type ConvexTokenSource,
} from '../../src/runtime/auth/token-fetcher'

describe('client Convex token exchange deadline', () => {
  it('settles immediately and aborts the request when its owner cancels', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    let calls = 0
    const source = {
      convex: {
        token: (options?: unknown) => {
          calls += 1
          capturedSignal = (options as { fetchOptions?: { signal?: AbortSignal } } | undefined)
            ?.fetchOptions?.signal
          return new Promise<{ data: null; error: null }>((_resolve, reject) => {
            capturedSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('source aborted', 'AbortError')),
              { once: true },
            )
          })
        },
      },
    } satisfies ConvexTokenSource

    try {
      const fetching = fetchConvexToken(source, { signal: controller.signal })
      controller.abort()

      await expect(fetching).resolves.toEqual({
        identity: null,
        authError: 'Convex authentication token exchange was cancelled',
        definitive: false,
      })
      expect(calls).toBe(1)
      expect(capturedSignal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a never-settling exchange, aborts it, and ignores its late result', async () => {
    vi.useFakeTimers()
    let resolveExchange!: (value: { data: null; error: null }) => void
    let capturedSignal: AbortSignal | undefined
    let calls = 0
    const source = {
      convex: {
        token: (options?: unknown) => {
          calls += 1
          capturedSignal = (options as { fetchOptions?: { signal?: AbortSignal } } | undefined)
            ?.fetchOptions?.signal
          return new Promise<{ data: null; error: null }>((resolve) => {
            resolveExchange = resolve
          })
        },
      },
    } satisfies ConvexTokenSource

    try {
      let settled = false
      const fetching = fetchConvexToken(source).then((outcome) => {
        settled = true
        return outcome
      })

      await vi.advanceTimersByTimeAsync(4_999)
      expect(settled).toBe(false)
      expect(capturedSignal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(fetching).resolves.toEqual({
        identity: null,
        authError: 'Convex authentication token exchange timed out',
        definitive: false,
      })
      expect(calls).toBe(1)
      expect(capturedSignal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)

      resolveExchange({ data: null, error: null })
      await Promise.resolve()
      expect(calls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the deadline after the ordinary bounded retry loop settles', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const source = {
      convex: {
        token: async (options?: unknown) => {
          const signal = (options as { fetchOptions?: { signal?: AbortSignal } } | undefined)
            ?.fetchOptions?.signal
          if (signal) signals.push(signal)
          return { data: null, error: { status: 503, message: 'unavailable' } }
        },
      },
    } satisfies ConvexTokenSource

    try {
      await expect(fetchConvexToken(source)).resolves.toEqual({
        identity: null,
        authError: 'Authentication is temporarily unavailable',
        definitive: false,
      })
      expect(signals).toHaveLength(MAX_FETCH_ATTEMPTS)
      expect(signals.every((signal) => !signal.aborted)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['error envelope', 'rejection'] as const)(
    'drops raw message, cause, and stack sentinels from an upstream %s',
    async (mode) => {
      const sentinels = {
        message: `BROWSER_AUTH_MESSAGE_SENTINEL_${mode}`,
        cause: `BROWSER_AUTH_CAUSE_SENTINEL_${mode}`,
        stack: `BROWSER_AUTH_STACK_SENTINEL_${mode}`,
      }
      const rawError = new Error(sentinels.message, { cause: new Error(sentinels.cause) })
      rawError.stack = sentinels.stack
      const source = {
        convex: {
          token: async () => {
            if (mode === 'rejection') throw rawError
            return { data: null, error: rawError }
          },
        },
      } satisfies ConvexTokenSource

      const outcome = await fetchConvexToken(source, { maxAttempts: 1 })
      const rendered = inspect(outcome, { depth: null })

      expect(outcome).toEqual({
        identity: null,
        authError: 'Authentication is temporarily unavailable',
        definitive: false,
      })
      for (const sentinel of Object.values(sentinels)) expect(rendered).not.toContain(sentinel)
    },
  )
})

describe('client Convex token exchange outcomes', () => {
  it('settles a nullable successful response as clean anonymous state', async () => {
    const source = {
      convex: { token: async () => ({ data: { token: null }, error: null }) },
    } satisfies ConvexTokenSource

    await expect(fetchConvexToken(source)).resolves.toEqual({
      identity: null,
      authError: null,
      definitive: true,
    })
  })

  it.each([401, 403])('reports rejected credentials from HTTP %s', async (status) => {
    const source = {
      convex: { token: async () => ({ data: null, error: { status } }) },
    } satisfies ConvexTokenSource

    await expect(fetchConvexToken(source)).resolves.toEqual({
      identity: null,
      authError: 'Authentication credentials are invalid or expired',
      definitive: true,
    })
  })
})
