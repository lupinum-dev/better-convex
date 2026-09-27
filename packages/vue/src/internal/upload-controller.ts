import type { GenericId } from 'convex/values'
import { shallowRef, type ShallowRef } from 'vue'

import {
  ConvexCallError,
  normalizeConvexError,
  type ConvexCallErrorCode,
  type ConvexCallOutcome,
  type ConvexUploadPhase,
} from '../errors'
import type { ClientCallStatus } from './call-state'
import { createIdentityChangedError, isIdentityChangedError } from './identity-changed-error'
import type { InternalOperation, OperationController } from './operation-controller'
import { canPostFiles, type UploadProgressInfo } from './upload-transport'
import { isFileTypeAllowed } from './upload-validation'

/** What one finished upload produced. */
export interface ConvexFileUploadResult<Prepared = string, Completed = undefined> {
  /** The storage ID the upload endpoint returned. */
  readonly storageId: GenericId<'_storage'>
  /** The upload-URL mutation's result. */
  readonly prepared: Prepared
  /** The completion step's result, or `undefined` without `complete`. */
  readonly completed: Completed
}

export interface UploadCompleteContext<Prepared = unknown> {
  readonly prepared: Prepared
  readonly storageId: GenericId<'_storage'>
  readonly file: File
}

export interface FileUploadViewState {
  readonly status: ClientCallStatus
  readonly error: ConvexCallError | undefined
  readonly data: ConvexFileUploadResult<unknown, unknown> | undefined
  readonly progress: UploadProgressInfo
}

const EMPTY_PROGRESS: UploadProgressInfo = Object.freeze({ loaded: 0, total: 0, percent: 0 })
const IDLE_STATE: FileUploadViewState = Object.freeze({
  status: 'idle',
  error: undefined,
  data: undefined,
  progress: EMPTY_PROGRESS,
})

/** Package-private observation seam; Nuxt feeds its logger from it. */
export interface ConvexFileUploadObserver {
  succeeded(event: { readonly file: File; readonly durationMs: number }): void
  failed(event: {
    readonly file: File
    readonly error: ConvexCallError
    readonly durationMs?: number
  }): void
}

export interface FileUploadControllerInput {
  /** The upload-URL mutation; names every failure outside the `complete` phase. */
  readonly functionName: string
  readonly maxSize?: number
  readonly allowedTypes?: readonly string[]
  /** `false` when no browser Convex client exists, for example during SSR. */
  readonly available: boolean
  readonly operations: OperationController
  /** Run the upload-URL mutation as a step of `operation`. */
  prepare(operation: InternalOperation, args: unknown): Promise<unknown>
  /** Select the upload URL from the prepared result. */
  readonly url?: (prepared: unknown) => string
  /** Run the completion; its Convex calls are steps of `operation`. */
  readonly complete?: (
    operation: InternalOperation,
    context: UploadCompleteContext,
  ) => Promise<unknown>
  readonly observer?: ConvexFileUploadObserver
}

export interface FileUploadController {
  readonly state: Readonly<ShallowRef<FileUploadViewState>>
  upload(file: File, args: unknown): Promise<ConvexFileUploadResult<unknown, unknown>>
  cancel(): void
  reset(): void
  dispose(): void
}

function withPhase(error: ConvexCallError, phase: ConvexUploadPhase): ConvexCallError {
  if (error.phase !== undefined) return error
  return new ConvexCallError({ ...error.toJSON(), phase })
}

function withOutcome(error: ConvexCallError, outcome: ConvexCallOutcome): ConvexCallError {
  if (error.outcome === outcome) return error
  return new ConvexCallError({ ...error.toJSON(), outcome })
}

/** An upload failure with one of these codes always records an outcome. */
const RETIREMENT_CODES: ReadonlySet<string> = new Set(['IDENTITY_CHANGED', 'CANCELLED'])

/**
 * The one single-file upload workflow: prepare (the upload-URL mutation),
 * upload (the storage POST), and an optional complete step, all dispatched as
 * steps of one operation that is bound to the identity current when
 * `upload()` starts.
 *
 * An identity change retires in-flight and finished state synchronously; no
 * later phase is sent. `cancel()`, `reset()`, and disposal return to `idle`,
 * never `error`: a phase not yet sent is never sent, an in-flight storage POST
 * is aborted, and a Convex call already sent settles with its real result.
 * Each state transition is one atomic snapshot, so a synchronous watcher
 * never observes (or re-enters through) a half-cleared state.
 */
export function createFileUploadController(input: FileUploadControllerInput): FileUploadController {
  const { functionName, operations } = input
  const state = shallowRef<FileUploadViewState>(IDLE_STATE)
  let currentAttempt: { readonly operation: InternalOperation } | null = null
  let disposed = false

  const libraryError = (
    code: ConvexCallErrorCode,
    message: string,
    extra: { outcome?: ConvexCallOutcome; phase?: ConvexUploadPhase } = {},
  ) => new ConvexCallError({ kind: 'unknown', code, message, functionName, ...extra })

  const report = (callback: () => void) => {
    try {
      callback()
    } catch {
      // Diagnostics are non-authoritative and cannot replace the outcome.
    }
  }

  /** Publish idle, then cancel the attempt that was current before publishing. */
  const retire = () => {
    // Snapshot first: a synchronous watcher may start a fresh upload while the
    // idle state publishes, and only this attempt may be retired here.
    const attempt = currentAttempt
    state.value = IDLE_STATE
    if (currentAttempt === attempt) currentAttempt = null
    attempt?.operation.cancel()
  }

  const stopIdentity = operations.onIdentityChange(retire)

  const selectUrl = (prepared: unknown): string => {
    let url: unknown = prepared
    if (input.url) {
      try {
        url = input.url(prepared)
      } catch {
        throw libraryError('INVALID_UPLOAD_URL', 'The url option threw while selecting the URL', {
          outcome: 'not-sent',
          phase: 'upload',
        })
      }
    }
    if (typeof url !== 'string' || url.length === 0) {
      throw libraryError(
        'INVALID_UPLOAD_URL',
        input.url
          ? 'The url option must return a non-empty string URL'
          : 'generateUploadUrl mutation must return a string URL',
        { outcome: 'not-sent', phase: 'upload' },
      )
    }
    return url
  }

  const upload = async (
    file: File,
    args: unknown,
  ): Promise<ConvexFileUploadResult<unknown, unknown>> => {
    const startedAt = Date.now()
    if (disposed) {
      throw libraryError('CANCELLED', 'Convex upload cancelled: its owner was disposed.', {
        outcome: 'not-sent',
      })
    }
    // The published state is the synchronous concurrency guard, including the
    // prepare phase before the storage POST begins.
    if (state.value.status === 'pending') {
      const error = libraryError(
        'UPLOAD_IN_PROGRESS',
        'An upload is already in progress for this composable.',
        { outcome: 'not-sent' },
      )
      report(() => input.observer?.failed({ file, error }))
      throw error
    }

    // Every phase is a step of this operation: the identity is fixed here.
    const operation = operations.begin()
    const identityRetired = () => isIdentityChangedError(operation.retirement)
    let phase: ConvexUploadPhase | undefined
    let sentBeforePhase = 0
    const enterPhase = (next: ConvexUploadPhase) => {
      phase = next
      sentBeforePhase = operation.sentSteps
    }
    // The outcome describes the whole failed phase, not only its last step: a
    // completion that sent one call and then failed before sending the next
    // may have written something that references the stored file.
    const phaseOutcome = (error: ConvexCallError): ConvexCallError => {
      const phaseSent = operation.sentSteps > sentBeforePhase
      if (error.outcome === 'not-sent') return phaseSent ? withOutcome(error, 'unknown') : error
      // An `op.signal.reason` rethrown by the completion's own work.
      if (error.outcome === undefined && error.code && RETIREMENT_CODES.has(error.code)) {
        return withOutcome(error, phaseSent ? 'unknown' : 'not-sent')
      }
      return error
    }
    // The completion is application code that may call several functions;
    // its failures name their own function.
    const phaseFunctionName = () => (phase === 'complete' ? undefined : functionName)
    const identityChangedError = (outcome: ConvexCallOutcome, failedFunction?: string) => {
      const error = createIdentityChangedError('upload', {
        functionName: failedFunction ?? phaseFunctionName(),
        outcome,
      })
      return phaseOutcome(phase ? withPhase(error, phase) : error)
    }
    const requireCurrentIdentity = (outcome: ConvexCallOutcome) => {
      if (identityRetired()) throw identityChangedError(outcome)
    }
    // A same-identity watcher may start fresh work while a terminal state
    // publishes; only an identity change invalidates this settled result.
    const publishTerminal = (next: FileUploadViewState, outcome: ConvexCallOutcome) => {
      requireCurrentIdentity(outcome)
      state.value = next
      requireCurrentIdentity(outcome)
    }
    const publishFailure = (error: ConvexCallError, progress = EMPTY_PROGRESS) => {
      const crossedOutcome = error.outcome === 'not-sent' ? 'not-sent' : 'unknown'
      publishTerminal({ status: 'error', error, data: undefined, progress }, crossedOutcome)
      report(() => input.observer?.failed({ file, error, durationMs: Date.now() - startedAt }))
      requireCurrentIdentity(crossedOutcome)
      return error
    }

    // Client-side preflight never reaches the network.
    if (input.maxSize !== undefined && file.size > input.maxSize) {
      throw publishFailure(
        libraryError(
          'FILE_TOO_LARGE',
          `File size ${file.size} bytes exceeds maximum ${input.maxSize} bytes`,
          { outcome: 'not-sent' },
        ),
      )
    }
    if (input.allowedTypes && !isFileTypeAllowed(file.type, input.allowedTypes)) {
      throw publishFailure(
        libraryError(
          'FILE_TYPE_NOT_ALLOWED',
          `File type "${file.type}" not allowed. Allowed: ${input.allowedTypes.join(', ')}`,
          { outcome: 'not-sent' },
        ),
      )
    }
    // The storage POST needs XHR for byte progress; a server has neither it
    // nor a browser Convex client, so no upload URL may be minted there.
    if (!input.available || !canPostFiles()) {
      throw publishFailure(
        libraryError(
          'CLIENT_UNAVAILABLE',
          'No browser Convex client is available. Upload files from the browser.',
          { outcome: 'not-sent' },
        ),
      )
    }

    const attempt = { operation }
    currentAttempt = attempt
    const isCurrent = () => currentAttempt === attempt && !operation.retired

    try {
      state.value = {
        status: 'pending',
        error: undefined,
        data: undefined,
        progress: { loaded: 0, total: file.size, percent: 0 },
      }

      enterPhase('prepare')
      const prepared = await input.prepare(operation, args)

      enterPhase('upload')
      const url = selectUrl(prepared)
      const storageId = await operation.upload(url, file, {
        onProgress: (progress) => {
          if (isCurrent()) state.value = { ...state.value, progress }
        },
      })

      let completed: unknown
      if (input.complete) {
        enterPhase('complete')
        completed = await input.complete(operation, { prepared, storageId, file })
      }

      const result: ConvexFileUploadResult<unknown, unknown> = Object.freeze({
        storageId,
        prepared,
        completed,
      })
      requireCurrentIdentity('unknown')
      // cancel(), reset(), or disposal already own the state; the work itself
      // finished, so its result is still the truth for this caller.
      if (currentAttempt !== attempt) return result
      publishTerminal({ ...state.value, status: 'success', data: result }, 'unknown')
      report(() => input.observer?.succeeded({ file, durationMs: Date.now() - startedAt }))
      requireCurrentIdentity('unknown')
      return result
    } catch (cause) {
      const normalized = normalizeConvexError(cause, { functionName: phaseFunctionName() })
      const error = phaseOutcome(phase ? withPhase(normalized, phase) : normalized)
      const { outcome } = error
      if (isIdentityChangedError(error)) {
        if (currentAttempt === attempt) retire()
        throw error
      }
      if (identityRetired()) {
        if (currentAttempt === attempt) retire()
        throw identityChangedError(
          outcome === 'not-sent' ? 'not-sent' : 'unknown',
          normalized.functionName,
        )
      }
      // cancel(), reset(), or disposal already published idle.
      if (currentAttempt !== attempt) throw error
      throw publishFailure(error, state.value.progress)
    } finally {
      if (currentAttempt === attempt) currentAttempt = null
      operation.finish()
    }
  }

  return {
    state,
    upload,
    cancel() {
      if (currentAttempt) retire()
    },
    reset() {
      retire()
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopIdentity()
      retire()
    },
  }
}
