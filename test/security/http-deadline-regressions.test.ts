import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithTimeout } from '../../src/runtime/server/utils/http'

// The stalled-body deadline itself is pinned by the seeded `proxy-timeout`
// corpus in test/auth-fuzz/body-timeout-boundaries.test.ts.
describe('server fetch deadline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function stalledFetch() {
    let signal: AbortSignal | undefined
    const cancel = vi.fn()
    const response = await fetchWithTimeout('https://upstream.example', {
      timeoutMs: 50,
      fetchImpl: async (_input, init) => {
        signal = init?.signal ?? undefined
        return new Response(new ReadableStream({ start() {}, cancel }))
      },
    })
    return { response, cancel, signal: () => signal }
  }

  it('clears the deadline and cancels the source when the caller cancels', async () => {
    const { response, cancel, signal } = await stalledFetch()

    await response.body?.cancel('caller finished')
    await vi.advanceTimersByTimeAsync(51)
    expect(cancel).toHaveBeenCalledOnce()
    expect(signal()?.aborted).toBe(false)
  })

  it('cancels an unread response body at the same deadline', async () => {
    const { cancel, signal } = await stalledFetch()

    await vi.advanceTimersByTimeAsync(51)
    expect(signal()?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('settles an abort/read race without retaining a reader lock', async () => {
    let releaseChunk: (() => void) | undefined
    const source = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise<void>((resolve) => {
          releaseChunk = resolve
        })
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const response = await fetchWithTimeout('https://upstream.example', {
      timeoutMs: 50,
      fetchImpl: async () => new Response(source),
    })
    const read = response.body?.getReader().read()
    const readFailure = expect(read).rejects.toThrow('Request timed out after 50ms')

    await vi.advanceTimersByTimeAsync(51)
    releaseChunk?.()
    await readFailure
    expect(source.locked).toBe(false)
  })
})
