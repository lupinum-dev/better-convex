import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  getRequestBodySizeError,
  getResponseBodySizeError,
  readRequestBodyWithLimit,
  readResponseBodyWithLimit,
  DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES,
  DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES,
} from '../../src/runtime/server/api/auth/body-size'

function streamFromText(input: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input))
      controller.close()
    },
  })
}

function eventFromStream(stream: ReadableStream<Uint8Array>) {
  return {
    method: 'POST',
    node: { req: { socket: undefined } },
    web: { request: { body: stream } },
  } as never
}

describe('auth proxy body size guards', () => {
  it('fixes both auth proxy body limits at one MiB', () => {
    expect(DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES).toBe(1_048_576)
    expect(DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES).toBe(1_048_576)
  })

  it('ignores missing and malformed content-length headers', () => {
    expect(getRequestBodySizeError(null)).toBeNull()
    expect(getRequestBodySizeError('not-a-number')).toBeNull()
    expect(getResponseBodySizeError(null)).toBeNull()
    expect(getResponseBodySizeError('not-a-number')).toBeNull()
  })

  it('rejects oversized request bodies with 413', () => {
    const error = getRequestBodySizeError(String(DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES + 1))
    expect(error?.statusCode).toBe(413)
    expect(error?.code).toBe('BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE')
  })

  it('rejects oversized upstream responses with 502', () => {
    const error = getResponseBodySizeError(String(DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES + 1))
    expect(error?.statusCode).toBe(502)
    expect(error?.code).toBe('BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE')
  })

  it('accepts payloads exactly at the configured limits', () => {
    expect(getRequestBodySizeError(String(DEFAULT_MAX_PROXY_REQUEST_BODY_BYTES))).toBeNull()
    expect(getResponseBodySizeError(String(DEFAULT_MAX_PROXY_RESPONSE_BODY_BYTES))).toBeNull()
  })

  it('supports stricter internal limits without exposing module configuration', () => {
    expect(getRequestBodySizeError('11', 10)?.maxBytes).toBe(10)
    expect(getResponseBodySizeError('11', 10)?.maxBytes).toBe(10)
  })

  it('enforces request body limits while reading the stream', async () => {
    await expect(
      readRequestBodyWithLimit(eventFromStream(streamFromText('too large')), 3),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
      maxBytes: 3,
    })
  })

  it('enforces upstream response body limits while reading the stream', async () => {
    const response = new Response(streamFromText('too large'))

    await expect(readResponseBodyWithLimit(response, 3)).rejects.toMatchObject({
      statusCode: 502,
      code: 'BCN_AUTH_PROXY_UPSTREAM_BODY_TOO_LARGE',
      maxBytes: 3,
    })
  })

  it('returns exact bounded request and response bodies', async () => {
    await expect(
      readRequestBodyWithLimit(eventFromStream(streamFromText('abc')), 3),
    ).resolves.toEqual(new TextEncoder().encode('abc'))

    const response = new Response(streamFromText('abc'))
    await expect(readResponseBodyWithLimit(response, 3)).resolves.toEqual(
      new TextEncoder().encode('abc'),
    )
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

  it('removes live Node listeners and pauses input when the streamed limit is exceeded', async () => {
    const request = Object.assign(new EventEmitter(), {
      complete: false,
      pause: vi.fn(),
      readableEnded: false,
      socket: {},
    })
    const event = { node: { req: request } } as never
    const result = readRequestBodyWithLimit(event, 4)

    expect(request.listenerCount('data')).toBe(1)
    request.emit('data', Buffer.alloc(5))

    await expect(result).rejects.toMatchObject({
      code: 'BCN_AUTH_PROXY_REQUEST_BODY_TOO_LARGE',
      statusCode: 413,
    })
    expect(request.pause).toHaveBeenCalledOnce()
    for (const name of ['data', 'end', 'error', 'aborted', 'close']) {
      expect(request.listenerCount(name), name).toBe(0)
    }
  })

  it('removes live Node listeners and pauses input when the shared signal aborts', async () => {
    const request = Object.assign(new EventEmitter(), {
      complete: false,
      pause: vi.fn(),
      readableEnded: false,
      socket: {},
    })
    const event = { node: { req: request } } as never
    const controller = new AbortController()
    const reason = new Error('test request deadline')
    const result = readRequestBodyWithLimit(event, 4, controller.signal)

    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    expect(request.pause).toHaveBeenCalledOnce()
    for (const name of ['data', 'end', 'error', 'aborted', 'close']) {
      expect(request.listenerCount(name), name).toBe(0)
    }
  })
})
