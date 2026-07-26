import { inspect } from 'node:util'
import { MessageChannel } from 'node:worker_threads'

import { ConvexError, convexToJson } from 'convex/values'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConvexCallError,
  isSerializedConvexCallError,
  normalizeConvexError,
  type ConvexCallErrorInput,
} from '../../src/runtime/errors'
import {
  CONVEX_HTTP_ACTION_TIMEOUT_MS,
  CONVEX_HTTP_MUTATION_TIMEOUT_MS,
  CONVEX_HTTP_QUERY_TIMEOUT_MS,
  createBoundedConvexFetch,
} from '../../src/runtime/utils/bounded-convex-fetch'
import { executeQueryHttp } from '../../src/runtime/utils/query-execution'

/**
 * Golden fixtures for the public error contract (architecture invariant).
 *
 * The pure normalizer classifies only from reliable evidence. It NEVER classifies
 * a `TypeError` as `transport` and NEVER classifies from message text. `transport`
 * and `authentication` are boundary-owned: a library-owned HTTP/auth boundary
 * constructs the instance while it still knows the source, and re-normalizing that
 * instance passes it through unchanged.
 */

const SECRET = 'super-secret-token-do-not-leak'

/** Throwing path: throw the normalized error. */
function throwingCall(raw: unknown): ConvexCallError {
  try {
    throw raw
  } catch (error) {
    return normalizeConvexError(error)
  }
}

/** Safe path: return the normalized error, same normalizer as the throwing path. */
function safeCall(raw: unknown): ConvexCallError {
  return normalizeConvexError(raw)
}

/** Mirror the payload plugin's reducer + reviver without importing Nuxt. */
function payloadRoundTrip(error: ConvexCallError): unknown {
  const reduced = JSON.parse(JSON.stringify(error.toJSON())) as unknown
  if (!isSerializedConvexCallError(reduced)) return undefined
  return new ConvexCallError({
    kind: reduced.kind,
    message: reduced.message,
    code: reduced.code,
    status: reduced.status,
    data: reduced.data,
  })
}

describe('ConvexCallError golden fixtures ', () => {
  it('1. auth-context-created authentication error (boundary-owned, passes through)', () => {
    const authError = new ConvexCallError({
      kind: 'authentication',
      message: 'Required identity missing',
      code: 'UNAUTHENTICATED',
    })

    expect(authError.kind).toBe('authentication')
    // Re-normalizing a boundary-classified instance never downgrades it.
    expect(normalizeConvexError(authError)).toBe(authError)
    expect(authError.toJSON()).toEqual({
      name: 'ConvexCallError',
      kind: 'authentication',
      message: 'Required identity missing',
      code: 'UNAUTHENTICATED',
      status: undefined,
      data: undefined,
    })
  })

  it('2. unstructured Convex argument-validation failure stays unknown', () => {
    // The pinned Convex packages surface arg-validation failures as plain errors
    // with no structured marker; they must not be classified from message text.
    const validationFailure = new Error(
      'ArgumentValidationError: Object contains extra field `foo`',
    )
    const normalized = normalizeConvexError(validationFailure)
    expect(normalized.kind).toBe('unknown')
    expect(normalized).toBeInstanceOf(ConvexCallError)
  })

  it('3a. boundary-wrapped fetch rejection is transport and passes through', () => {
    // The HTTP boundary constructs the transport error while it knows the source.
    const boundary = new ConvexCallError({
      kind: 'transport',
      message: 'The request could not reach Convex.',
    })
    expect(boundary.kind).toBe('transport')
    expect(normalizeConvexError(boundary)).toBe(boundary)
    expect('cause' in boundary).toBe(false)
  })

  it('3b. a plain application TypeError stays unknown (never transport)', () => {
    const appTypeError = new TypeError("Cannot read properties of undefined (reading 'id')")
    const normalized = normalizeConvexError(appTypeError)
    expect(normalized.kind).toBe('unknown')
  })

  it('4. timeout / abort is boundary-owned transport', () => {
    const boundary = new ConvexCallError({
      kind: 'transport',
      code: 'ABORTED',
      message: 'The request timed out.',
    })
    expect(boundary.kind).toBe('transport')
    expect(boundary.code).toBe('ABORTED')
    expect(normalizeConvexError(boundary)).toBe(boundary)
  })

  it('5. unexpected upstream HTTP response is boundary-owned transport', () => {
    const boundary = new ConvexCallError({
      kind: 'transport',
      status: 502,
      message: 'Convex returned an unexpected response.',
    })
    expect(boundary.kind).toBe('transport')
    expect(boundary.status).toBe(502)
    // The sentinel lives only in cause and never reaches the public shape.
    expect(JSON.stringify(boundary)).not.toContain(SECRET)
  })

  it('6. Convex application error with structured data is server, data verbatim', () => {
    const data = {
      code: 'UNAUTHORIZED',
      reason: 'forbidden',
      nested: { a: 1 },
    }
    const appError = new ConvexError(data)
    const normalized = normalizeConvexError(appError)

    expect(normalized.kind).toBe('server')
    // `data.code === 'UNAUTHORIZED'` remains server, never re-classified as auth.
    expect(normalized.code).toBe('UNAUTHORIZED')
    expect(normalized.data).toEqual(data)
    expect(normalized).toBeInstanceOf(ConvexCallError)
  })

  it('6b. cross-package ConvexError marker (not instanceof) is still server', () => {
    const markerOnly = {
      message: 'application error from a duplicate convex copy',
      data: { code: 'DUPLICATE_COPY' },
      [Symbol.for('ConvexError')]: true,
    }
    const normalized = normalizeConvexError(markerOnly)
    expect(normalized.kind).toBe('server')
    expect(normalized.data).toEqual({ code: 'DUPLICATE_COPY' })
  })

  it('6c. mere `data` property presence without the marker stays unknown', () => {
    const notAnApplicationError = {
      message: 'looks structured',
      data: { code: 'NOPE' },
    }
    expect(normalizeConvexError(notAnApplicationError).kind).toBe('unknown')
  })

  it('7. plain Error is unknown', () => {
    const normalized = normalizeConvexError(new Error('boom'))
    expect(normalized.kind).toBe('unknown')
    expect(normalized.message).toBe('boom')
  })

  it('8. string and object unknown errors', () => {
    const fromString = normalizeConvexError('a bare string failure')
    expect(fromString.kind).toBe('unknown')
    expect(fromString.message).toBe('a bare string failure')

    const fromMessageObject = normalizeConvexError({
      message: 'object with message',
    })
    expect(fromMessageObject.kind).toBe('unknown')
    expect(fromMessageObject.message).toBe('object with message')

    const fromOpaqueObject = normalizeConvexError({ unrelated: true })
    expect(fromOpaqueObject.kind).toBe('unknown')
    expect(fromOpaqueObject.message).toBe('Unknown Convex error')
  })

  it('9. an existing ConvexCallError passes through unchanged (identity)', () => {
    const existing = new ConvexCallError({
      kind: 'server',
      message: 'already normalized',
    })
    expect(normalizeConvexError(existing)).toBe(existing)
  })
})

describe('throwing and safe calls are equivalent ', () => {
  const rawFailures: Array<{ name: string; raw: unknown }> = [
    { name: 'plain Error', raw: new Error('boom') },
    { name: 'ConvexError', raw: new ConvexError({ code: 'X', reason: 'y' }) },
    { name: 'string', raw: 'bare string' },
    { name: 'opaque object', raw: { unrelated: 1 } },
  ]

  for (const { name, raw } of rawFailures) {
    it(`equal toJSON and both instanceof for ${name}`, () => {
      const thrown = throwingCall(raw)
      const safe = safeCall(raw)
      expect(thrown).toBeInstanceOf(ConvexCallError)
      expect(safe).toBeInstanceOf(ConvexCallError)
      expect(thrown.toJSON()).toEqual(safe.toJSON())
    })
  }
})

describe('ConvexCallError class contract: raw causes are not retained ', () => {
  const publicInput: ConvexCallErrorInput = {
    kind: 'transport',
    message: 'boundary failure',
    status: 500,
  }

  it('has no native or custom cause state', () => {
    const error = new ConvexCallError(publicInput)
    expect('cause' in error).toBe(false)
    expect(Object.getOwnPropertyDescriptor(error, 'cause')).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
  })

  it('toJSON omits cause entirely', () => {
    const error = new ConvexCallError(publicInput)
    const json = error.toJSON()
    expect('cause' in json).toBe(false)
    expect(JSON.stringify(json)).not.toContain(SECRET)
  })

  it('JSON.stringify(error) is clean of cause content', () => {
    const raw = new Error('safe upstream failure', {
      cause: { authorization: `Bearer ${SECRET}`, cookie: SECRET },
    })
    const error = normalizeConvexError(raw)
    const serialized = JSON.stringify(error)
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain('authorization')
  })

  it('keeps raw cause data out of enumeration and logs', () => {
    const raw = new Error('safe upstream failure', {
      cause: { authorization: `Bearer ${SECRET}`, cookie: SECRET },
    })
    const error = normalizeConvexError(raw)

    expect(Object.keys(error)).not.toContain('cause')
    expect(Object.prototype.hasOwnProperty.call({ ...error }, 'cause')).toBe(false)

    const inspected = inspect(error)
    expect(inspected).not.toContain(SECRET)
    expect(inspected).not.toContain('authorization')
    expect(inspected).toContain('safe upstream failure')
  })

  it('keeps raw cause data out of structured clone and MessageChannel transfer', async () => {
    const raw = new Error('safe upstream failure', {
      cause: { authorization: `Bearer ${SECRET}`, cookie: SECRET },
    })
    const error = normalizeConvexError(raw)
    const cloned = structuredClone(error)
    expect(inspect(cloned, { depth: null })).not.toContain(SECRET)
    expect('cause' in cloned).toBe(false)

    const { port1, port2 } = new MessageChannel()
    const transferred = new Promise<unknown>((resolve) => port2.once('message', resolve))
    port1.postMessage(error)
    const received = await transferred
    port1.close()
    port2.close()
    expect(inspect(received, { depth: null })).not.toContain(SECRET)
    expect(received && typeof received === 'object' && 'cause' in received).toBe(false)
  })

  it('survives a payload round-trip as instanceof ConvexCallError without cause', () => {
    const original = new ConvexCallError({
      kind: 'server',
      message: 'application failure',
      code: 'FORBIDDEN',
      status: 403,
      data: { code: 'FORBIDDEN', detail: 'nope' },
    })

    const revived = payloadRoundTrip(original)
    expect(revived).toBeInstanceOf(ConvexCallError)
    const typed = revived as ConvexCallError
    expect(typed.kind).toBe('server')
    expect(typed.message).toBe('application failure')
    expect(typed.code).toBe('FORBIDDEN')
    expect(typed.status).toBe(403)
    expect(typed.data).toEqual({ code: 'FORBIDDEN', detail: 'nope' })
    expect('cause' in typed).toBe(false)
  })
})

describe('isSerializedConvexCallError strictness ', () => {
  it('accepts a valid serialized shape', () => {
    const valid = {
      name: 'ConvexCallError',
      kind: 'server',
      message: 'ok',
      code: undefined,
      status: undefined,
      data: undefined,
    }
    expect(isSerializedConvexCallError(valid)).toBe(true)
  })

  it('rejects an arbitrary object that only carries the name string', () => {
    expect(isSerializedConvexCallError({ name: 'ConvexCallError' })).toBe(false)
    expect(
      isSerializedConvexCallError({
        name: 'ConvexCallError',
        kind: 'nope',
        message: 'x',
      }),
    ).toBe(false)
    expect(
      isSerializedConvexCallError({
        name: 'ConvexCallError',
        kind: 'server',
        message: 42,
      }),
    ).toBe(false)
    expect(isSerializedConvexCallError('ConvexCallError')).toBe(false)
    expect(isSerializedConvexCallError(null)).toBe(false)
  })
})

/**
 * Audit gap (W8): the golden fixtures above exercise `normalizeConvexError`
 * directly. The SSR boundary uses the official Convex HTTP client for its wire
 * format and adds only deadline, abort, cache, and response-size controls.
 */
describe('executeQueryHttp boundary (architecture invariant)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a fetch rejection becomes a boundary-owned transport error without retaining it', async () => {
    const secret = 'query-execution-boundary-secret'
    const fetchRejection = Object.assign(new Error('fetch failed'), {
      data: { rawBody: secret },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(fetchRejection)),
    )

    let caught: unknown
    try {
      await executeQueryHttp('https://example.convex.cloud', 'notes:list', {})
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ConvexCallError)
    const error = caught as ConvexCallError
    expect(error.kind).toBe('transport')
    expect(error.message).toBe('Convex HTTP request could not complete')
    expect('cause' in error).toBe(false)
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('uses official Convex encoding for arguments, values, and structured errors', async () => {
    const value = {
      id: 'notes:1',
      bigint: 9_007_199_254_740_993n,
      bytes: new Uint8Array([0, 1, 255]).buffer,
      nan: Number.NaN,
      positiveInfinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      negativeZero: -0,
      nested: { nullable: null },
    }
    const calls: Array<{ body: unknown; cache: RequestCache | undefined }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_input, init) => {
        calls.push({
          body: JSON.parse(String(init?.body)) as unknown,
          cache: init?.cache,
        })
        return Promise.resolve(
          Response.json({
            status: 'success',
            value: convexToJson(value),
            logLines: [],
          }),
        )
      }),
    )

    const result = await executeQueryHttp<typeof value>(
      'https://example.convex.cloud',
      'notes:list',
      { cursor: null, count: 1n },
      'opaque.jwt',
    )

    expect(result).toEqual(value)
    expect(Object.is(result.negativeZero, -0)).toBe(true)
    expect(calls).toEqual([
      {
        body: {
          args: [convexToJson({ cursor: null, count: 1n })],
          format: 'convex_encoded_json',
          path: 'notes:list',
        },
        cache: 'no-store',
      },
    ])
  })

  it('preserves structured Convex errors and makes non-UDF upstream failures opaque', async () => {
    const responses = [
      new Response(
        JSON.stringify({
          status: 'error',
          errorMessage: 'safe application error',
          errorData: convexToJson({ code: 'FORBIDDEN', reason: 'nope' }),
        }),
        { status: 560 },
      ),
      new Response('UPSTREAM_BODY_SECRET', { status: 503 }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(responses.shift()!)),
    )

    await expect(
      executeQueryHttp('https://example.convex.cloud', 'notes:list', {}),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN', reason: 'nope' } })

    let caught: unknown
    try {
      await executeQueryHttp('https://example.convex.cloud', 'notes:list', {})
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      kind: 'transport',
      message: 'The request to Convex failed before a usable response was received.',
      status: 503,
    })
    expect(JSON.stringify(caught)).not.toContain('UPSTREAM_BODY_SECRET')
  })

  it('enforces response bounds before and during body consumption', async () => {
    for (const operation of ['query', 'mutation', 'action']) {
      const declared = createBoundedConvexFetch({
        fetchImpl: () =>
          Promise.resolve(
            new Response('small', {
              headers: { 'content-length': String(1024) },
            }),
          ),
        maxResponseBytes: 4,
      })
      await expect(declared(`https://example.convex.cloud/api/${operation}`)).rejects.toMatchObject(
        {
          kind: 'transport',
        },
      )

      const streamed = createBoundedConvexFetch({
        fetchImpl: () => Promise.resolve(new Response('12345')),
        maxResponseBytes: 4,
      })
      await expect(
        (await streamed(`https://example.convex.cloud/api/${operation}`)).text(),
      ).rejects.toMatchObject({
        kind: 'transport',
      })
    }
  })

  it('propagates parent abort and enforces the request deadline', async () => {
    vi.useFakeTimers()
    const neverFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        })
      })
    const parent = new AbortController()
    const aborted = createBoundedConvexFetch({
      fetchImpl: neverFetch,
      signal: parent.signal,
    })
    const abortedRequest = aborted('https://example.test')
    const abortedExpectation = expect(abortedRequest).rejects.toMatchObject({
      kind: 'transport',
      message: 'Convex HTTP request was aborted',
    })
    parent.abort()
    await abortedExpectation

    const timed = createBoundedConvexFetch({
      fetchImpl: neverFetch,
      timeoutMs: 25,
    })
    const timedRequest = timed('https://example.test')
    const timedExpectation = expect(timedRequest).rejects.toMatchObject({
      kind: 'transport',
      message: 'Convex HTTP request timed out',
    })
    await vi.advanceTimersByTimeAsync(25)
    await timedExpectation

    const bodyTimed = createBoundedConvexFetch({
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('partial'))
              },
            }),
          ),
        ),
      timeoutMs: 25,
    })
    const body = await bodyTimed('https://example.test')
    const bodyExpectation = expect(body.text()).rejects.toMatchObject({
      kind: 'transport',
      message: 'Convex HTTP request timed out',
    })
    await vi.advanceTimersByTimeAsync(25)
    await bodyExpectation
    vi.useRealTimers()
  })

  it.each([
    ['query', CONVEX_HTTP_QUERY_TIMEOUT_MS],
    ['mutation', CONVEX_HTTP_MUTATION_TIMEOUT_MS],
    ['action', CONVEX_HTTP_ACTION_TIMEOUT_MS],
  ] as const)('applies the reviewed %s operation deadline', async (operation, timeoutMs) => {
    vi.useFakeTimers()
    const neverFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        })
      })
    const bounded = createBoundedConvexFetch({ fetchImpl: neverFetch })
    const pending = bounded(`https://example.convex.cloud/api/${operation}`)
    const expectation = expect(pending).rejects.toMatchObject({
      kind: 'transport',
      message: 'Convex HTTP request timed out',
    })

    await vi.advanceTimersByTimeAsync(timeoutMs - 1)
    await expect(
      Promise.race([
        pending.then(
          () => 'settled',
          () => 'settled',
        ),
        Promise.resolve('pending'),
      ]),
    ).resolves.toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    await expectation
    vi.useRealTimers()
  })
})
