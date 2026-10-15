import { describe, expect, it, vi } from 'vitest'

import {
  readRequestBodyWithLimit,
  readResponseBodyWithLimit,
} from '../../src/runtime/server/api/auth/body-size'

describe('auth proxy stream cleanup regressions', () => {
  it('cancels an upstream response stream as soon as streamed bytes exceed the limit', async () => {
    const cancel = vi.fn()
    let pullCount = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1
        controller.enqueue(new Uint8Array(pullCount === 1 ? 4 : 1))
      },
      cancel,
    })

    await expect(readResponseBodyWithLimit(new Response(stream), 4)).rejects.toMatchObject({
      code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
      status: 502,
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels a stalled request stream when the shared proxy signal aborts', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the read pending until the request-wide deadline aborts it.
      },
      cancel,
    })
    const controller = new AbortController()
    const reason = new Error('test proxy deadline')
    const result = readRequestBodyWithLimit(
      {
        req: new Request('https://app.example.test/api/auth/test', {
          method: 'POST',
          body: stream,
          duplex: 'half',
        } as RequestInit),
        res: { headers: new Headers() },
        context: {},
      },
      4,
      controller.signal,
    )

    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(reason))
    expect(stream.locked).toBe(false)
  })

  it('fully consumes a bounded response without cancelling it', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 255, 1, 2]))
        controller.close()
      },
      cancel,
    })

    await expect(readResponseBodyWithLimit(new Response(stream), 4)).resolves.toEqual(
      new Uint8Array([0, 255, 1, 2]),
    )
    expect(cancel).not.toHaveBeenCalled()
  })
})
