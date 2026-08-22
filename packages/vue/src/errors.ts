import { ConvexError } from 'convex/values'

/**
 * The public, framework-free error contract for Better Convex.
 *
 * This module is deliberately unaware of Nuxt, Vue, Nitro, Better Auth, the DOM,
 * and Node built-ins. Its only third-party import is the public Convex error
 * value (`convex/values`), because honest classification of application errors
 * requires recognizing `ConvexError`. The boundary is enforced mechanically by
 * `scripts/check-boundaries.mjs` (`errors-framework-free`) and by the packed
 * purity probe (architecture invariant).
 */

/**
 * The locked public kind set. There is intentionally no
 * `validation` kind: the pinned Convex package exposes no stable
 * argument-validation class or marker, and normalization never classifies from message
 * text. Add a new kind only when a future pinned Convex release provides a
 * mechanically testable signal.
 *
 * | Kind             | Only valid sources                                               |
 * | ---------------- | ---------------------------------------------------------------- |
 * | `authentication` | Missing required identity, token exchange 401/403, explicit      |
 * |                  | auth-engine classification.                                      |
 * | `transport`      | Fetch/XHR failure, timeout, abort, unusable/oversized/malformed  |
 * |                  | response, or unexpected upstream HTTP response observed at a     |
 * |                  | library-owned HTTP boundary.                                     |
 * | `server`         | Convex application/function error with `data` preserved verbatim.|
 * | `unknown`        | Anything not mechanically classifiable above.                    |
 */
export type ConvexCallErrorKind = 'authentication' | 'transport' | 'server' | 'unknown'

const CONVEX_CALL_ERROR_KINDS: readonly ConvexCallErrorKind[] = [
  'authentication',
  'transport',
  'server',
  'unknown',
]
const CONVEX_APPLICATION_ERROR_MESSAGE = 'Convex application error'
const UNKNOWN_CONVEX_ERROR_MESSAGE = 'Unknown Convex error'

export interface ConvexCallErrorInput {
  kind: ConvexCallErrorKind
  message: string
  code?: string
  status?: number
  data?: unknown
}

/**
 * The single honest error type every failed Convex operation exposes.
 *
 * Raw upstream causes are deliberately not retained on this public error
 * object. Library-owned credentials, tokens, cookies, request/response objects,
 * authorization headers, stacks, and response bodies must never enter its
 * public fields.
 */
export class ConvexCallError extends Error {
  readonly kind: ConvexCallErrorKind
  readonly code?: string
  readonly status?: number
  readonly data?: unknown

  constructor(input: ConvexCallErrorInput) {
    super(input.message)
    this.name = 'ConvexCallError'
    this.kind = input.kind
    this.code = input.code
    this.status = input.status
    this.data = input.data
  }

  /**
   * The public serialized shape. `cause` is intentionally omitted so no
   * private upstream value can escape into a payload, log, or DevTools event.
   */
  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      code: this.code,
      status: this.status,
      data: this.data,
    }
  }
}

/**
 * Node's custom-inspection hook (referenced by its well-known key, NOT imported
 * from `node:util`, so the framework-free purity guard stays satisfied). When a
 * `ConvexCallError` reaches a server-side `console.*` call, Node renders this
 * redacted public shape instead of the default error format — which would
 * Returning `toJSON()` guarantees logs carry exactly the serialized public
 * contract.
 */
const NODE_INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom')
Object.defineProperty(ConvexCallError.prototype, NODE_INSPECT_CUSTOM, {
  value(this: ConvexCallError) {
    return this.toJSON()
  },
  enumerable: false,
  writable: true,
  configurable: true,
})

/** The exact object shape produced by {@link ConvexCallError.toJSON}. */
export interface SerializedConvexCallError {
  name: 'ConvexCallError'
  kind: ConvexCallErrorKind
  message: string
  code?: string
  status?: number
  data?: unknown
}

// ---------------------------------------------------------------------------
// Framework-free helpers (all referenced by the normalizer, all in-module).
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isConvexCallErrorKind(value: unknown): value is ConvexCallErrorKind {
  return CONVEX_CALL_ERROR_KINDS.includes(value as ConvexCallErrorKind)
}

/**
 * Recognize a Convex application error through the pinned `ConvexError` contract
 * OR its exact cross-package marker `error[Symbol.for('ConvexError')] === true`,
 * matching Convex's installed implementation. Marker equality keeps structured
 * application errors recognizable when the host and library resolve different
 * physical Convex copies. Mere property presence is insufficient.
 */
function isConvexApplicationError(error: unknown): boolean {
  if (error instanceof ConvexError) return true
  if (!isRecordLike(error)) return false
  return (error as Record<PropertyKey, unknown>)[Symbol.for('ConvexError')] === true
}

/** The Convex application error's structured payload, preserved verbatim. */
function readStructuredData(error: unknown): unknown {
  return isRecordLike(error) ? error.data : undefined
}

/** A stable string code, preferring the structured `data.code` when present. */
function readCode(error: unknown): string | undefined {
  const data = readStructuredData(error)
  if (isRecordLike(data)) {
    const fromData = asNonEmptyString(data.code)
    if (fromData) return fromData
  }
  return isRecordLike(error) ? asNonEmptyString(error.code) : undefined
}

/** A numeric status, preferring the structured `data.status` when present. */
function readStatus(error: unknown): number | undefined {
  const data = readStructuredData(error)
  if (isRecordLike(data)) {
    const fromData = asFiniteNumber(data.status)
    if (fromData !== undefined) return fromData
  }
  return isRecordLike(error) ? asFiniteNumber(error.status) : undefined
}

/**
 * Mechanically safe, framework-free normalization (architecture invariant).
 *
 * - An existing {@link ConvexCallError} passes through unchanged, so
 *   re-normalizing a boundary-classified `transport`/`authentication` instance
 *   never downgrades it.
 * - A Convex application error becomes `server` with its `data` preserved
 *   verbatim and a fixed display message. Convex's wire message may contain UDF
 *   frames, so it is never copied into the public error.
 * - Everything else becomes `unknown` with a fixed display message. The pure
 *   normalizer NEVER classifies a `TypeError` as `transport` (it cannot know
 *   whether user code or a network API created it) and NEVER classifies from
 *   message text. Fetch, XHR,
 *   timeout, abort, oversized-, malformed-, and unexpected-upstream-HTTP
 *   boundaries construct `ConvexCallError({ kind: 'transport', ... })`
 *   themselves, while the boundary still knows the source.
 */
export function normalizeConvexError(error: unknown): ConvexCallError {
  if (error instanceof ConvexCallError) return error
  if (isConvexApplicationError(error)) {
    return new ConvexCallError({
      kind: 'server',
      message: CONVEX_APPLICATION_ERROR_MESSAGE,
      code: readCode(error),
      status: readStatus(error),
      data: readStructuredData(error),
    })
  }
  return new ConvexCallError({
    kind: 'unknown',
    message: UNKNOWN_CONVEX_ERROR_MESSAGE,
  })
}

/**
 * Strict structural validation of the serialized public fields. This gates
 * payload revival: an arbitrary object is NOT revived
 * just because it carries `name: 'ConvexCallError'` — every public field must
 * be present and well-typed. `cause` is never part of the serialized shape.
 */
export function isSerializedConvexCallError(value: unknown): value is SerializedConvexCallError {
  if (!isRecordLike(value)) return false
  if (value.name !== 'ConvexCallError') return false
  if (!isConvexCallErrorKind(value.kind)) return false
  if (typeof value.message !== 'string') return false
  if (value.code !== undefined && asNonEmptyString(value.code) === undefined) return false
  if (value.status !== undefined && asFiniteNumber(value.status) === undefined) return false
  return true
}
