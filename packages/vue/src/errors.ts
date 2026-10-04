import { ConvexError } from 'convex/values'

/**
 * The public, framework-free error contract for Better Convex.
 *
 * This module imports nothing from Nuxt, Vue, Nitro, Better Auth, the DOM, or
 * Node. Its only third-party import is `convex/values`, which is needed to
 * recognize `ConvexError`. `scripts/check-boundaries.mjs`
 * (`errors-framework-free`) and the packed purity probe enforce the boundary.
 */

/**
 * Where a failure came from.
 *
 * | Kind             | Source                                                           |
 * | ---------------- | ---------------------------------------------------------------- |
 * | `authentication` | Missing required identity, a changed identity, or a failed token |
 * |                  | exchange.                                                        |
 * | `transport`      | A library-owned HTTP boundary: network failure, timeout, abort,  |
 * |                  | or an unusable or unexpected upstream response.                  |
 * | `server`         | A Convex application error (`ConvexError`), `data` kept verbatim.|
 * | `unknown`        | Anything else, including library-raised usage failures.          |
 *
 * Convex exposes no stable marker for argument-validation failures, so they are
 * `unknown`. Classification never reads message text.
 */
export type ConvexCallErrorKind = 'authentication' | 'transport' | 'server' | 'unknown'

/**
 * Stable codes for failures that Better Convex raises itself. Application codes
 * (from `ConvexError` `data.code`) stay plain strings in {@link ConvexCallError.code}.
 *
 * - `IDENTITY_CHANGED`: the auth identity changed before the call was sent or
 *   while it was in flight. Its `outcome` tells which: `not-sent`, or `unknown`
 *   (the write may have committed).
 * - `CANCELLED`: the work was cancelled or its owning scope was disposed. Its
 *   `outcome` tells whether the request was sent.
 * - `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`: client-side upload validation.
 * - `UPLOAD_IN_PROGRESS`, `SUBMIT_IN_PROGRESS`: a second upload or form submission
 *   started while the first one is still pending.
 * - `UNAUTHENTICATED`: the operation requires a signed-in identity.
 * - `CLIENT_UNAVAILABLE`: no browser Convex client exists, for example during SSR.
 * - `NETWORK_ERROR`: a library-owned HTTP request could not complete.
 * - `TIMEOUT`: a library-owned HTTP request exceeded its deadline.
 * - `RESPONSE_TOO_LARGE`: a response exceeded the configured size limit.
 * - `UPSTREAM_ERROR`: the upload endpoint, the Convex HTTP API, or the token
 *   exchange answered with a failure status.
 * - `INVALID_RESPONSE`: an upstream response had an unusable body.
 * - `INVALID_UPLOAD_URL`: the upload-URL mutation did not yield a usable URL:
 *   it returned no string and no `url` option selected one.
 * - `CONVEX_URL_MISSING`, `SITE_URL_MISSING`: the Convex URL or site URL is
 *   not configured.
 * - `AUTH_UNAVAILABLE`: the request identity could not be resolved because
 *   the auth backend failed.
 * - `AUTH_CONFIRMATION_TIMEOUT`: Convex did not confirm a new auth token in time.
 * - `PAGINATION_SPLIT_REQUIRED`: a page must be split before it can be shown.
 */
export type ConvexCallErrorCode =
  | 'IDENTITY_CHANGED'
  | 'CANCELLED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'UPLOAD_IN_PROGRESS'
  | 'SUBMIT_IN_PROGRESS'
  | 'UNAUTHENTICATED'
  | 'CLIENT_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'UPSTREAM_ERROR'
  | 'INVALID_RESPONSE'
  | 'INVALID_UPLOAD_URL'
  | 'CONVEX_URL_MISSING'
  | 'SITE_URL_MISSING'
  | 'AUTH_UNAVAILABLE'
  | 'AUTH_CONFIRMATION_TIMEOUT'
  | 'PAGINATION_SPLIT_REQUIRED'

/**
 * What the failing request did before it failed, recorded from the real
 * dispatch lifecycle and never inferred from `code`.
 *
 * - `not-sent`: the request was never handed to the network. Nothing it would
 *   have written exists.
 * - `unknown`: the request was sent but no result was confirmed (an identity
 *   change, a cancellation, or a lost connection crossed it). It may have
 *   committed.
 *
 * `undefined` means the failure is not tied to a dispatch outcome, for example
 * a confirmed server rejection.
 *
 * Neither value makes a retry safe by itself: a write sent twice commits twice
 * unless the application makes it idempotent (for example a client-generated
 * request ID the server deduplicates).
 */
export type ConvexCallOutcome = 'not-sent' | 'unknown'

/**
 * The `useConvexFileUpload` phase that failed: `prepare` (the upload-URL
 * mutation), `upload` (the storage POST), or `complete` (the `complete`
 * option). Every phase before it succeeded.
 *
 * With a phase, `outcome` describes the whole phase: `not-sent` means that
 * the phase sent no request. A `complete` phase that sent one call and then
 * failed before sending the next records `unknown`.
 */
export type ConvexUploadPhase = 'prepare' | 'upload' | 'complete'

const CONVEX_CALL_OUTCOMES: readonly ConvexCallOutcome[] = ['not-sent', 'unknown']
const CONVEX_UPLOAD_PHASES: readonly ConvexUploadPhase[] = ['prepare', 'upload', 'complete']
const CONVEX_CALL_ERROR_KINDS: readonly ConvexCallErrorKind[] = [
  'authentication',
  'transport',
  'server',
  'unknown',
]
const SERIALIZED_KEYS: ReadonlySet<string> = new Set([
  'name',
  'kind',
  'message',
  'code',
  'status',
  'data',
  'functionName',
  'outcome',
  'phase',
])
const CONVEX_APPLICATION_ERROR_MESSAGE = 'Convex application error'
const UNKNOWN_CONVEX_ERROR_MESSAGE = 'Unknown Convex error'

export interface ConvexCallErrorInput {
  kind: ConvexCallErrorKind
  message: string
  code?: string
  status?: number
  data?: unknown
  /** The Convex function path, for example `notes:create`. */
  functionName?: string
  /** Set only by the code that dispatched the request. See {@link ConvexCallOutcome}. */
  outcome?: ConvexCallOutcome
  /** Set only by `useConvexFileUpload`. See {@link ConvexUploadPhase}. */
  phase?: ConvexUploadPhase
}

/**
 * The one error type every failed Convex operation exposes.
 *
 * It never retains the raw upstream cause. Credentials, tokens, cookies,
 * request or response objects, headers, stacks, and response bodies must never
 * enter its public fields.
 */
export class ConvexCallError extends Error {
  readonly kind: ConvexCallErrorKind
  /** A {@link ConvexCallErrorCode} for library failures, or the application's `data.code`. */
  readonly code?: string
  readonly status?: number
  readonly data?: unknown
  /** The Convex function path when the failing call path knows it. */
  readonly functionName?: string
  /**
   * Whether the failing request was sent: `not-sent` or `unknown` (it may have
   * committed). Recorded by the dispatching code, never derived from `code`.
   * Retrying is only safe when the application makes the write idempotent.
   */
  readonly outcome?: ConvexCallOutcome
  /** The `useConvexFileUpload` phase that failed. */
  readonly phase?: ConvexUploadPhase

  constructor(input: ConvexCallErrorInput) {
    super(input.message)
    this.name = 'ConvexCallError'
    this.kind = input.kind
    this.code = input.code
    this.status = input.status
    this.data = input.data
    this.functionName = input.functionName
    this.outcome = input.outcome
    this.phase = input.phase
  }

  /** The public serialized shape. There is no `cause` to serialize. */
  toJSON(): SerializedConvexCallError {
    return {
      name: 'ConvexCallError',
      kind: this.kind,
      message: this.message,
      code: this.code,
      status: this.status,
      data: this.data,
      functionName: this.functionName,
      outcome: this.outcome,
      phase: this.phase,
    }
  }
}

/**
 * Node's custom-inspection hook, referenced by its well-known key instead of an
 * import from `node:util` so the module stays framework-free. Server-side
 * `console.*` output renders exactly the serialized public shape.
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

export interface ConvexFormIssue {
  readonly message: string
  readonly path: readonly PropertyKey[]
  readonly field?: string
}

export type ConvexFormErrorKind = 'validation' | 'submission'

type ConvexFormErrorInput = Readonly<{
  kind: ConvexFormErrorKind
  message: string
  issues?: readonly ConvexFormIssue[]
  fieldErrors?: Readonly<Record<string, readonly string[]>>
  formError?: string
  callError?: ConvexCallError
}>

/**
 * A safe form-facing failure from `useConvexForm`. Raw validator and mapper
 * causes are never retained; a `submission` failure keeps the mutation's
 * {@link ConvexCallError} as `callError`.
 */
export class ConvexFormError extends Error {
  readonly kind: ConvexFormErrorKind
  readonly issues: readonly ConvexFormIssue[]
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>
  readonly formError?: string
  readonly callError?: ConvexCallError

  constructor(input: ConvexFormErrorInput) {
    super(input.message)
    this.name = 'ConvexFormError'
    this.kind = input.kind
    this.issues = Object.freeze([...(input.issues ?? [])])
    this.fieldErrors = Object.freeze({ ...(input.fieldErrors ?? {}) })
    this.formError = input.formError
    this.callError = input.callError
  }

  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      issues: this.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === 'symbol' ? (segment.description ?? 'symbol') : segment,
        ),
        field: issue.field,
      })),
      fieldErrors: this.fieldErrors,
      formError: this.formError,
      callError: this.callError?.toJSON(),
    }
  }
}

/** The exact object shape produced by {@link ConvexCallError.toJSON}. */
export interface SerializedConvexCallError {
  name: 'ConvexCallError'
  kind: ConvexCallErrorKind
  message: string
  code?: string
  status?: number
  data?: unknown
  functionName?: string
  outcome?: ConvexCallOutcome
  phase?: ConvexUploadPhase
}

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

/** Read one property without letting a throwing getter or proxy trap escape. */
function readField(value: unknown, key: string): unknown {
  if (!isRecordLike(value)) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

/**
 * Copy the serialized fields once and validate the copy, so a getter or proxy
 * cannot pass validation and then produce different values. Only a plain object
 * with no keys beyond the public shape qualifies.
 */
function readSerialized(value: unknown): SerializedConvexCallError | undefined {
  if (!isRecordLike(value)) return undefined
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    if (Object.keys(value).some((key) => !SERIALIZED_KEYS.has(key))) return undefined
    const snapshot = {
      name: value.name,
      kind: value.kind,
      message: value.message,
      code: value.code,
      status: value.status,
      data: value.data,
      functionName: value.functionName,
      outcome: value.outcome,
      phase: value.phase,
    }
    if (snapshot.name !== 'ConvexCallError') return undefined
    if (!isConvexCallErrorKind(snapshot.kind)) return undefined
    if (typeof snapshot.message !== 'string') return undefined
    if (snapshot.code !== undefined && asNonEmptyString(snapshot.code) === undefined) {
      return undefined
    }
    if (snapshot.status !== undefined && asFiniteNumber(snapshot.status) === undefined) {
      return undefined
    }
    if (
      snapshot.functionName !== undefined &&
      asNonEmptyString(snapshot.functionName) === undefined
    ) {
      return undefined
    }
    if (
      snapshot.outcome !== undefined &&
      !CONVEX_CALL_OUTCOMES.includes(snapshot.outcome as ConvexCallOutcome)
    ) {
      return undefined
    }
    if (
      snapshot.phase !== undefined &&
      !CONVEX_UPLOAD_PHASES.includes(snapshot.phase as ConvexUploadPhase)
    ) {
      return undefined
    }
    return snapshot as SerializedConvexCallError
  } catch {
    return undefined
  }
}

/**
 * Recognize a Convex application error through `instanceof ConvexError` or its
 * exact cross-package marker `error[Symbol.for('ConvexError')] === true`, so
 * application errors stay recognizable when the host and library resolve
 * different Convex copies. Property presence alone is not enough.
 */
function isConvexApplicationError(error: unknown): boolean {
  if (error instanceof ConvexError) return true
  if (!isRecordLike(error)) return false
  try {
    return (error as Record<PropertyKey, unknown>)[Symbol.for('ConvexError')] === true
  } catch {
    return false
  }
}

/** A stable string code, preferring the structured `data.code`. */
function readCode(error: unknown, data: unknown): string | undefined {
  return asNonEmptyString(readField(data, 'code')) ?? asNonEmptyString(readField(error, 'code'))
}

/** A numeric status, preferring the structured `data.status`. */
function readStatus(error: unknown, data: unknown): number | undefined {
  return asFiniteNumber(readField(data, 'status')) ?? asFiniteNumber(readField(error, 'status'))
}

/**
 * The developer-authored text of a Convex application error: a string `data`,
 * then `data.message`. Convex's own wire message can contain UDF stack frames,
 * so it is never used.
 */
function readApplicationMessage(data: unknown): string {
  return (
    asNonEmptyString(data) ??
    asNonEmptyString(readField(data, 'message')) ??
    CONVEX_APPLICATION_ERROR_MESSAGE
  )
}

function withFunctionName(
  error: ConvexCallError,
  functionName: string | undefined,
): ConvexCallError {
  if (!functionName || error.functionName !== undefined) return error
  return new ConvexCallError({ ...fieldsOf(error), functionName })
}

/** The public fields of an error, for building a copy that changes one of them. */
function fieldsOf(error: ConvexCallError): ConvexCallErrorInput {
  return {
    kind: error.kind,
    message: error.message,
    code: error.code,
    status: error.status,
    data: error.data,
    functionName: error.functionName,
    outcome: error.outcome,
    phase: error.phase,
  }
}

function revive(serialized: SerializedConvexCallError, functionName: string | undefined) {
  return new ConvexCallError({
    kind: serialized.kind,
    message: serialized.message,
    code: serialized.code,
    status: serialized.status,
    data: serialized.data,
    functionName: serialized.functionName ?? functionName,
    outcome: serialized.outcome,
    phase: serialized.phase,
  })
}

/**
 * Turn any thrown value into a {@link ConvexCallError}.
 *
 * - An existing `ConvexCallError` passes through unchanged, so a
 *   boundary-classified `transport` or `authentication` error is never
 *   downgraded. When `context.functionName` names a function the error lacks,
 *   a copy that carries it is returned.
 * - A Convex application error becomes `server`. `data` is kept verbatim and
 *   `message` is the developer-authored text (a string `data`, else
 *   `data.message`), else a fixed generic message.
 * - A serialized `ConvexCallError` is revived when it is the value itself, its
 *   `.data` (an H3 error or H3 JSON body), or its `.data.data` (an ofetch
 *   `FetchError` of an H3 error). Each candidate must pass
 *   {@link isSerializedConvexCallError}.
 * - Everything else becomes `unknown` with a fixed message. A `TypeError` is
 *   never guessed to be `transport`; library HTTP boundaries construct
 *   `transport` errors themselves.
 */
export function normalizeConvexError(
  error: unknown,
  context?: { readonly functionName?: string },
): ConvexCallError {
  const functionName = asNonEmptyString(context?.functionName)
  if (error instanceof ConvexCallError) return withFunctionName(error, functionName)
  if (isConvexApplicationError(error)) {
    const data = readField(error, 'data')
    return new ConvexCallError({
      kind: 'server',
      message: readApplicationMessage(data),
      code: readCode(error, data),
      status: readStatus(error, data),
      data,
      functionName,
    })
  }
  const outerData = readField(error, 'data')
  const serialized =
    readSerialized(error) ??
    readSerialized(outerData) ??
    readSerialized(readField(outerData, 'data'))
  if (serialized) return revive(serialized, functionName)
  logUnknownCauseInDevelopment(error, functionName)
  return new ConvexCallError({
    kind: 'unknown',
    message: UNKNOWN_CONVEX_ERROR_MESSAGE,
    functionName,
  })
}

// The package compiles without Node types; this is the one global it reads.
declare const process: { readonly env: { readonly NODE_ENV?: string } }

/**
 * Nuxt and Vite dev servers replace `process.env.NODE_ENV` with
 * `'development'` at build time, also in the browser where no `process`
 * global exists, so the expression is read directly and never guarded with
 * `typeof process`. Builds, tests and runtimes without a replacement or a
 * `process` global answer false.
 */
function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV === 'development'
  } catch {
    return false
  }
}

const loggedCauses = new WeakSet<object>()

/**
 * The public error drops the original on purpose (no `cause`, nothing in the
 * SSR payload), so in development the original is logged once instead.
 * Without it, a client-side argument error (`convexToJson`) or a plain server
 * `Error` would leave no trace.
 */
function logUnknownCauseInDevelopment(error: unknown, functionName: string | undefined): void {
  if (!isDevelopment()) return
  if (typeof error === 'object' && error !== null) {
    if (loggedCauses.has(error)) return
    loggedCauses.add(error)
  }
  console.error(
    `[better-convex] ${functionName ?? 'A Convex call'} failed with an unclassified error (shown only in development):`,
    error,
  )
}

/**
 * Strict validation of the serialized public shape. It gates every revival:
 * the value must be a plain object with only the public keys, a known `kind`,
 * a string `message`, and, when present, a non-empty string `code` and
 * `functionName`, a finite `status`, a known `outcome`, and a known `phase`.
 * A `name: 'ConvexCallError'` alone is never enough.
 */
export function isSerializedConvexCallError(value: unknown): value is SerializedConvexCallError {
  return readSerialized(value) !== undefined
}

/**
 * True when `error` is a {@link ConvexCallError} and, when `code` is given, its
 * `code` equals it. Pass unknown values through {@link normalizeConvexError}
 * first to recognize serialized or H3-wrapped errors.
 */
export function isConvexCallError(
  error: unknown,
  code?: ConvexCallErrorCode | (string & {}),
): error is ConvexCallError {
  return error instanceof ConvexCallError && (code === undefined || error.code === code)
}
