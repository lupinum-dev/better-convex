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
      status: 413,
      code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
    })
    expect(getResponseBodySizeError('1048577')).toMatchObject({
      status: 502,
      code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
    })
  })

  // Nuxt 4 in-process requests (`$fetch` inside the server) hand h3 an unenv
  // mock request whose socket never emits data, and h3 1.x may already hold
  // the body. Catches the proxy forwarding an empty body, or waiting on the
  // mock stream until the deadline, instead of reading the held bytes.
  const text = (value: string) => new TextEncoder().encode(value)
  it.each([
    ['an unenv string body', { __unenv__: {}, body: 'a=1' }, {}, text('a=1')],
    ['an unenv byte body', { __unenv__: {}, body: text('bytes') }, {}, text('bytes')],
    ['an unenv JSON object body', { __unenv__: {}, body: { a: 1 } }, {}, text('{"a":1}')],
    [
      'an unenv form body',
      { __unenv__: {}, body: new URLSearchParams({ a: '1' }) },
      {},
      text('a=1'),
    ],
    ['an unenv request without a body', { __unenv__: {}, body: null }, {}, new Uint8Array()],
    [
      'an h3-cached raw body',
      { [Symbol.for('h3RawBody')]: Promise.resolve(text('cached')) },
      {},
      text('cached'),
    ],
    [
      'a body h3 1.x took from a web Request',
      {},
      {
        _requestBody: new ReadableStream({
          start(controller) {
            controller.enqueue(text('web'))
            controller.close()
          },
        }),
      },
      text('web'),
    ],
  ])('reads %s before the live Node request stream', async (_name, fields, eventFields, body) => {
    const request = Object.assign(new EventEmitter(), { socket: {} }, fields)
    const event = { context: {}, node: { req: request, res: {} }, ...eventFields }

    await expect(readRequestBodyWithLimit(event, 64)).resolves.toEqual(body)
    expect(request.listenerCount('data')).toBe(0)
  })

  // The web-shaped source (no Node request: Nitro 3 `serverFetch`, edge
  // presets) is pinned by the seeded `proxy-body-size` corpus in
  // test/auth-fuzz/body-timeout-boundaries.test.ts.

  function liveRequest() {
    const request = Object.assign(new EventEmitter(), {
      complete: false,
      pause: vi.fn(),
      readableEnded: false,
      socket: {},
    })
    const controller = new AbortController()
    const result = readRequestBodyWithLimit(
      { context: {}, node: { req: request, res: {} } },
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
      status: 413,
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
