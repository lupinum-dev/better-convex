import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  getRequestBodySizeError,
  getResponseBodySizeError,
  readRequestBodyWithLimit,
} from '../../src/runtime/server/api/auth/body-size'

describe('auth proxy body size guards', () => {
  it('ignores missing and malformed content-length headers', () => {
    expect(getRequestBodySizeError(null)).toBeNull()
    expect(getRequestBodySizeError('not-a-number')).toBeNull()
    expect(getResponseBodySizeError(null)).toBeNull()
    expect(getResponseBodySizeError('not-a-number')).toBeNull()
  })

  // Streamed limits and custom limits are pinned by the seeded `proxy-body-size`
  // corpus in test/auth-fuzz/body-timeout-boundaries.test.ts.
  it('accepts the default limits exactly and rejects one byte more', () => {
    expect(getRequestBodySizeError('1048576')).toBeNull()
    expect(getResponseBodySizeError('1048576')).toBeNull()
    expect(getRequestBodySizeError('1048577')).toMatchObject({
      statusCode: 413,
      code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
    })
    expect(getResponseBodySizeError('1048577')).toMatchObject({
      statusCode: 502,
      code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
    })
  })

  it('uses an H3-cached raw body before the live Node request stream', async () => {
    const cached = new TextEncoder().encode('cached')
    const event = {
      method: 'POST',
      node: {
        req: {
          [Symbol.for('h3RawBody')]: Promise.resolve(cached),
          socket: {},
        },
      },
    } as never

    await expect(readRequestBodyWithLimit(event, cached.byteLength)).resolves.toEqual(cached)
  })

  function liveRequest() {
    const request = Object.assign(new EventEmitter(), {
      complete: false,
      pause: vi.fn(),
      readableEnded: false,
      socket: {},
    })
    const controller = new AbortController()
    const result = readRequestBodyWithLimit(
      { node: { req: request } } as never,
      4,
      controller.signal,
    )
    const expectReleased = () => {
      expect(request.pause).toHaveBeenCalledOnce()
      for (const name of ['data', 'end', 'error', 'aborted', 'close']) {
        expect(request.listenerCount(name), name).toBe(0)
      }
    }
    return { request, controller, result, expectReleased }
  }

  it('removes live Node listeners and pauses input when the streamed limit is exceeded', async () => {
    const { request, result, expectReleased } = liveRequest()

    expect(request.listenerCount('data')).toBe(1)
    request.emit('data', Buffer.alloc(5))

    await expect(result).rejects.toMatchObject({
      code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
      statusCode: 413,
    })
    expectReleased()
  })

  it('removes live Node listeners and pauses input when the shared signal aborts', async () => {
    const { controller, result, expectReleased } = liveRequest()
    const reason = new Error('test request deadline')

    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    expectReleased()
  })
})
