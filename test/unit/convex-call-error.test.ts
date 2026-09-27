import { inspect } from 'node:util'
import { MessageChannel } from 'node:worker_threads'

import { ConvexError, convexToJson } from 'convex/values'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConvexCallError,
  isConvexCallError,
  isSerializedConvexCallError,
  normalizeConvexError,
  type ConvexCallErrorCode,
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

/** Mirror the payload plugin's reducer + reviver without importing Nuxt. */
function payloadRoundTrip(error: ConvexCallError): unknown {
  const reduced = JSON.parse(JSON.stringify(error.toJSON())) as unknown
  if (!isSerializedConvexCallError(reduced)) return undefined
  return normalizeConvexError(reduced)
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
    expect(authError.toJSON()).toStrictEqual({
      name: 'ConvexCallError',
      kind: 'authentication',
      message: 'Required identity missing',
      code: 'UNAUTHENTICATED',
      status: undefined,
      data: undefined,
      functionName: undefined,
      outcome: undefined,
      phase: undefined,
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
      status: 403,
      reason: 'forbidden',
      nested: { a: 1 },
    }
    const appError = new ConvexError(data)
    Object.defineProperty(appError, 'message', {
      value: `Uncaught ConvexError: ${SECRET}\n    at handler (../convex/private.ts:1:1)`,
    })
    const normalized = normalizeConvexError(appError)

    expect(normalized.kind).toBe('server')
    expect(normalized.message).toBe('Convex application error')
    // `data.code === 'UNAUTHORIZED'` remains server, never re-classified as auth.
    expect(normalized.code).toBe('UNAUTHORIZED')
    expect(normalized.status).toBe(403)
    expect(normalized.data).toEqual(data)
    expect(normalized).toBeInstanceOf(ConvexCallError)
    expect(inspect(normalized)).not.toContain(SECRET)
  })

  it('6b. cross-package ConvexError marker (not instanceof) is still server', () => {
    const markerOnly = {
      message: 'application error from a duplicate convex copy',
      data: { code: 'DUPLICATE_COPY' },
      [Symbol.for('ConvexError')]: true,
    }
    const normalized = normalizeConvexError(markerOnly)
    expect(normalized.kind).toBe('server')
    expect(normalized.message).toBe('Convex application error')
    expect(normalized.data).toEqual({ code: 'DUPLICATE_COPY' })
  })

  it('6d. a string ConvexError payload becomes the message', () => {
    const appError = new ConvexError('Title is already taken')
    Object.defineProperty(appError, 'message', {
      value: `Uncaught ConvexError: ${SECRET}\n    at handler (../convex/private.ts:1:1)`,
    })
    const normalized = normalizeConvexError(appError, { functionName: 'notes:create' })

    expect(normalized.kind).toBe('server')
    expect(normalized.message).toBe('Title is already taken')
    expect(normalized.data).toBe('Title is already taken')
    expect(normalized.code).toBeUndefined()
    expect(normalized.functionName).toBe('notes:create')
    expect(JSON.stringify(normalized)).not.toContain(SECRET)
  })

  it('6e. a structured payload message becomes the message, never the wire message', () => {
    const appError = new ConvexError({ code: 'TITLE_TAKEN', message: 'Title is already taken' })
    Object.defineProperty(appError, 'message', {
      value: `Uncaught ConvexError: ${SECRET}\n    at handler (../convex/private.ts:1:1)`,
    })
    const normalized = normalizeConvexError(appError)

    expect(normalized.message).toBe('Title is already taken')
    expect(normalized.code).toBe('TITLE_TAKEN')
    expect(normalized.functionName).toBeUndefined()
    expect(inspect(normalized)).not.toContain(SECRET)
  })

  it.each([
    ['an empty string payload', ''],
    ['an empty data.message', { message: '' }],
    ['a non-string data.message', { message: 42 }],
    ['a numeric payload', 7],
    ['a null payload', null],
  ])('6f. %s falls back to the generic application message', (_name, data) => {
    const normalized = normalizeConvexError(new ConvexError(data as never))
    expect(normalized.kind).toBe('server')
    expect(normalized.message).toBe('Convex application error')
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
    expect(normalized.message).toBe('Unknown Convex error')
  })

  it('8. string and object unknown errors', () => {
    const fromString = normalizeConvexError('a bare string failure')
    expect(fromString.kind).toBe('unknown')
    expect(fromString.message).toBe('Unknown Convex error')

    const fromMessageObject = normalizeConvexError({
      message: 'object with message',
    })
    expect(fromMessageObject.kind).toBe('unknown')
    expect(fromMessageObject.message).toBe('Unknown Convex error')

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
    expect(normalizeConvexError(existing, {})).toBe(existing)
  })

  it('10. context fills a missing function name without changing the classification', () => {
    const boundary = new ConvexCallError({
      kind: 'transport',
      code: 'ABORTED',
      status: 504,
      message: 'The request timed out.',
      data: { retryable: true },
    })
    const named = normalizeConvexError(boundary, { functionName: 'notes:create' })

    expect(named).not.toBe(boundary)
    expect(named).toBeInstanceOf(ConvexCallError)
    expect(named.toJSON()).toStrictEqual({ ...boundary.toJSON(), functionName: 'notes:create' })
    expect('cause' in named).toBe(false)

    // A known name is never replaced, and an empty context name is ignored.
    expect(normalizeConvexError(named, { functionName: 'other:fn' })).toBe(named)
    expect(normalizeConvexError(boundary, { functionName: '' })).toBe(boundary)
  })

  it('11. context names unknown and application failures', () => {
    expect(normalizeConvexError(new Error('boom'), { functionName: 'notes:list' })).toMatchObject({
      kind: 'unknown',
      message: 'Unknown Convex error',
      functionName: 'notes:list',
    })
    expect(
      normalizeConvexError(new ConvexError({ code: 'X' }), { functionName: 'notes:save' }),
    ).toMatchObject({ kind: 'server', code: 'X', functionName: 'notes:save' })
  })
})

describe('isConvexCallError', () => {
  it('narrows instances and optionally matches a code', () => {
    const cancelled = new ConvexCallError({
      kind: 'unknown',
      code: 'CANCELLED',
      message: 'cancelled',
    })
    const application = normalizeConvexError(new ConvexError({ code: 'NOTE_EXISTS' }))

    expect(isConvexCallError(cancelled)).toBe(true)
    expect(isConvexCallError(cancelled, 'CANCELLED')).toBe(true)
    expect(isConvexCallError(cancelled, 'IDENTITY_CHANGED')).toBe(false)
    expect(isConvexCallError(application, 'NOTE_EXISTS')).toBe(true)
    expect(isConvexCallError(application, 'CANCELLED')).toBe(false)
  })

  it('rejects shapes that were not normalized first', () => {
    const serialized = new ConvexCallError({
      kind: 'unknown',
      code: 'CANCELLED',
      message: 'cancelled',
    }).toJSON()

    expect(isConvexCallError(serialized)).toBe(false)
    expect(isConvexCallError(serialized, 'CANCELLED')).toBe(false)
    expect(isConvexCallError(new Error('plain'))).toBe(false)
    expect(isConvexCallError(null)).toBe(false)
    expect(isConvexCallError(normalizeConvexError(serialized), 'CANCELLED')).toBe(true)
  })

  it('names every library code in the public union', () => {
    const codes = {
      IDENTITY_CHANGED: true,
      CANCELLED: true,
      FILE_TOO_LARGE: true,
      FILE_TYPE_NOT_ALLOWED: true,
      UPLOAD_IN_PROGRESS: true,
      SUBMIT_IN_PROGRESS: true,
      UNAUTHENTICATED: true,
      CLIENT_UNAVAILABLE: true,
      NETWORK_ERROR: true,
      TIMEOUT: true,
      RESPONSE_TOO_LARGE: true,
      UPSTREAM_ERROR: true,
      INVALID_RESPONSE: true,
      INVALID_UPLOAD_URL: true,
      CONVEX_URL_MISSING: true,
      SITE_URL_MISSING: true,
      AUTH_UNAVAILABLE: true,
      AUTH_CONFIRMATION_TIMEOUT: true,
      PAGINATION_SPLIT_REQUIRED: true,
    } satisfies Record<ConvexCallErrorCode, true>
    expect(Object.keys(codes)).toHaveLength(19)
  })
})

describe('normalizeConvexError revives serialized errors from the H3 wire', () => {
  const original = new ConvexCallError({
    kind: 'authentication',
    code: 'UNAUTHENTICATED',
    status: 401,
    message: 'Sign in to continue',
    data: { reason: 'missing-session' },
    functionName: 'notes:list',
  })
  const wire = () => JSON.parse(JSON.stringify(original)) as Record<string, unknown>

  function expectRevived(value: unknown) {
    const revived = normalizeConvexError(value)
    expect(revived).toBeInstanceOf(ConvexCallError)
    expect(revived.toJSON()).toStrictEqual(original.toJSON())
    expect('cause' in revived).toBe(false)
    return revived
  }

  it('revives the serialized error itself', () => {
    expectRevived(wire())
  })

  it('revives the data of an H3 error or H3 JSON body', () => {
    const h3Body = {
      error: true,
      url: '/api/notes',
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Sign in to continue',
      data: wire(),
    }
    expectRevived(h3Body)
    expectRevived(Object.assign(new Error('H3Error'), { statusCode: 401, data: wire() }))
  })

  it('revives the nested data of an ofetch FetchError of an H3 error', () => {
    const fetchError = Object.assign(new Error('[GET] "/api/notes": 401 Unauthorized'), {
      name: 'FetchError',
      status: 401,
      statusCode: 401,
      data: { error: true, statusCode: 401, message: 'Sign in to continue', data: wire() },
    })
    expectRevived(fetchError)
  })

  it('fills a missing function name from context but keeps a serialized one', () => {
    const { functionName: _omit, ...unnamed } = wire()
    expect(normalizeConvexError(unnamed, { functionName: 'client:ctx' }).functionName).toBe(
      'client:ctx',
    )
    expect(normalizeConvexError(wire(), { functionName: 'client:ctx' }).functionName).toBe(
      'notes:list',
    )
  })

  it('keeps a ConvexError whose payload looks serialized as a server error', () => {
    const forged = new ConvexError(wire() as never)
    const normalized = normalizeConvexError(forged)
    expect(normalized.kind).toBe('server')
    expect(normalized.message).toBe('Sign in to continue')
  })

  const hostile: Array<[string, (valid: Record<string, unknown>) => unknown]> = [
    ['an extra field', (valid) => ({ ...valid, stack: 'at secret (private.ts:1:1)' })],
    ['an extra cause', (valid) => ({ ...valid, cause: { authorization: SECRET } })],
    ['an unknown kind', (valid) => ({ ...valid, kind: 'validation' })],
    ['a missing kind', ({ kind: _kind, ...rest }) => rest],
    ['a non-string message', (valid) => ({ ...valid, message: { text: SECRET } })],
    ['a missing message', ({ message: _message, ...rest }) => rest],
    ['a numeric code', (valid) => ({ ...valid, code: 401 })],
    ['an empty code', (valid) => ({ ...valid, code: '' })],
    ['a string status', (valid) => ({ ...valid, status: '401' })],
    ['a non-finite status', (valid) => ({ ...valid, status: Number.POSITIVE_INFINITY })],
    ['an empty function name', (valid) => ({ ...valid, functionName: '' })],
    ['a non-string function name', (valid) => ({ ...valid, functionName: ['notes:list'] })],
    ['a different name', (valid) => ({ ...valid, name: 'Error' })],
    [
      'a class instance',
      (valid) => Object.assign(Object.create({ inherited: true }) as object, valid),
    ],
    ['an array', () => [wire()]],
    ['a string', () => JSON.stringify(wire())],
  ]

  for (const [name, make] of hostile) {
    it(`does not revive ${name} at any wrapper depth`, () => {
      const candidate = make(wire())
      expect(isSerializedConvexCallError(candidate)).toBe(false)
      for (const value of [candidate, { data: candidate }, { data: { data: candidate } }]) {
        const normalized = normalizeConvexError(value)
        expect(normalized.kind).toBe('unknown')
        expect(normalized.message).toBe('Unknown Convex error')
        expect(normalized.code).toBeUndefined()
        expect(JSON.stringify(normalized)).not.toContain(SECRET)
      }
    })
  }

  it('does not revive deeper than data.data', () => {
    expect(normalizeConvexError({ data: { data: { data: wire() } } }).kind).toBe('unknown')
    expect(normalizeConvexError({ cause: wire() }).kind).toBe('unknown')
    expect(normalizeConvexError({ error: wire() }).kind).toBe('unknown')
  })

  it('never throws on throwing getters and reads each field once', () => {
    const throwing = {
      get data() {
        throw new Error(SECRET)
      },
    }
    expect(normalizeConvexError(throwing)).toMatchObject({ kind: 'unknown' })
    expect(isSerializedConvexCallError(throwing)).toBe(false)

    let reads = 0
    const flipping = {
      name: 'ConvexCallError',
      kind: 'unknown',
      get message() {
        reads += 1
        return reads === 1 ? 'first read' : { secret: SECRET }
      },
    }
    // An accessor-backed message is copied once, so validation and the revived
    // value always agree.
    const revived = normalizeConvexError(flipping)
    expect(reads).toBe(1)
    expect(revived.message).toBe('first read')
  })
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
    expect(inspected).toContain('Unknown Convex error')
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

  it('accepts and round-trips functionName', () => {
    const named = new ConvexCallError({
      kind: 'server',
      message: 'Title is already taken',
      code: 'TITLE_TAKEN',
      functionName: 'notes:create',
    })
    const json = JSON.parse(JSON.stringify(named)) as unknown
    expect(isSerializedConvexCallError(json)).toBe(true)
    expect(payloadRoundTrip(named)).toMatchObject({ functionName: 'notes:create' })
  })

  it('accepts and round-trips the dispatch outcome and upload phase', () => {
    const crossed = new ConvexCallError({
      kind: 'authentication',
      message: 'Identity changed',
      code: 'IDENTITY_CHANGED',
      outcome: 'unknown',
      phase: 'complete',
    })
    const json = JSON.parse(JSON.stringify(crossed)) as unknown
    expect(json).toMatchObject({ outcome: 'unknown', phase: 'complete' })
    expect(isSerializedConvexCallError(json)).toBe(true)
    expect(payloadRoundTrip(crossed)).toMatchObject({ outcome: 'unknown', phase: 'complete' })
    // Naming a function on a copy keeps the dispatch evidence.
    expect(normalizeConvexError(crossed, { functionName: 'files:attach' })).toMatchObject({
      functionName: 'files:attach',
      outcome: 'unknown',
      phase: 'complete',
    })
  })

  it('rejects an unknown outcome or phase', () => {
    const base = { name: 'ConvexCallError', kind: 'server', message: 'x' }
    expect(isSerializedConvexCallError({ ...base, outcome: 'not-sent' })).toBe(true)
    expect(isSerializedConvexCallError({ ...base, outcome: 'committed' })).toBe(false)
    expect(isSerializedConvexCallError({ ...base, outcome: 1 })).toBe(false)
    expect(isSerializedConvexCallError({ ...base, phase: 'prepare' })).toBe(true)
    expect(isSerializedConvexCallError({ ...base, phase: 'verify' })).toBe(false)
    expect(normalizeConvexError({ ...base, outcome: 'committed' })).toMatchObject({
      kind: 'unknown',
      outcome: undefined,
    })
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
          errorMessage: `Uncaught ConvexError: ${SECRET}\n    at handler (../convex/private.ts:1:1)`,
          errorData: convexToJson({ code: 'FORBIDDEN', status: 403, reason: 'nope' }),
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
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN', status: 403, reason: 'nope' },
    })

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
