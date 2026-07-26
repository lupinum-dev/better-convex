import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSessionSynchronization } from '../../src/runtime/auth/session-synchronization'

describe('session synchronization', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles a barrier only after a matching later session observation', async () => {
    const synchronization = createSessionSynchronization({
      timeoutMs: 1_000,
      isDisposed: () => false,
      failClosed: vi.fn(),
    })
    const barrier = synchronization.createBarrier()
    let settled = false
    const waiting = barrier.wait('session-a').then(() => {
      settled = true
    })

    synchronization.observe('session-b')
    await Promise.resolve()
    expect(settled).toBe(false)

    synchronization.observe('session-a')
    await waiting
    expect(settled).toBe(true)
  })

  it('disposes every active barrier without waiting for another observation', async () => {
    const synchronization = createSessionSynchronization({
      timeoutMs: 1_000,
      isDisposed: () => false,
      failClosed: vi.fn(),
    })
    const waiting = synchronization.createBarrier().wait(null)

    synchronization.dispose()

    await expect(waiting).resolves.toBeUndefined()
  })

  it('fails closed once when an observation never reconciles', async () => {
    vi.useFakeTimers()
    const failClosed = vi.fn(async () => {})
    const synchronization = createSessionSynchronization({
      timeoutMs: 50,
      isDisposed: () => false,
      failClosed,
    })
    const waiting = synchronization.createBarrier().wait('session-a')
    const rejection = expect(waiting).rejects.toMatchObject({
      code: 'SESSION_RECONCILIATION_TIMEOUT',
      kind: 'authentication',
    })

    await vi.advanceTimersByTimeAsync(50)

    await rejection
    expect(failClosed).toHaveBeenCalledTimes(1)
  })
})
