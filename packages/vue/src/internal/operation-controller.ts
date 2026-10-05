import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId } from 'convex/values'

import {
  ConvexCallError,
  normalizeConvexError,
  type ConvexCallErrorCode,
  type ConvexCallOutcome,
} from '../errors'
import type { ConvexClientHandle } from './client-owner'
import { createIdentityChangedError, isIdentityChangedError } from './identity-changed-error'
import { snapshotArgs } from './snapshot-args'
import { canPostFiles, postFileToConvexStorage, type UploadProgressInfo } from './upload-transport'
import { checkUploadFile } from './upload-validation'

export type OperationStepKind = 'query' | 'mutation' | 'action' | 'upload'

export interface ConvexOperationUploadOptions {
  /** Byte progress of the storage POST. */
  readonly onProgress?: (progress: UploadProgressInfo) => void
  /**
   * Maximum file size in bytes. A larger file rejects with `FILE_TOO_LARGE`
   * and `outcome: 'not-sent'`; no request is made.
   */
  readonly maxSize?: number
  /**
   * Allowed MIME types: exact types and top-level wildcards such as
   * `image/*`. Another type rejects with `FILE_TYPE_NOT_ALLOWED` and
   * `outcome: 'not-sent'`; no request is made.
   */
  readonly allowedTypes?: readonly string[]
}

/**
 * One unit of work bound to the auth identity that was current when it began.
 *
 * Every step checks the identity immediately before it sends its request:
 *
 * - The identity changed (or the operation was cancelled) before the step was
 *   sent: the step rejects with `IDENTITY_CHANGED` (or `CANCELLED`) and
 *   `outcome: 'not-sent'`. Nothing was sent.
 * - The identity changed after the step was sent but before its result was
 *   confirmed: the step rejects with `IDENTITY_CHANGED` and
 *   `outcome: 'unknown'`. It may have committed.
 *
 * `cancel()`, the owner's `reset()`, and owner disposal stop later steps and
 * abort an in-flight `upload()`; a Convex call already sent settles with its
 * real result. Retrying a failed write is only safe when the application
 * makes it idempotent.
 */
export interface ConvexOperation {
  /** The operation retired: its identity changed, it was cancelled, or its owner was disposed. */
  readonly retired: boolean
  /**
   * Aborts when the operation retires while its work runs, with the
   * retirement `ConvexCallError` as `signal.reason`. Pass it to your own async
   * work (for example `fetch`). Once the work has settled, the signal no
   * longer aborts.
   */
  readonly signal: AbortSignal
  /** Retire the operation: later steps reject with `CANCELLED` before they are sent. */
  cancel(): void
  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>>
  action<Action extends FunctionReference<'action'>>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>>
  query<Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>>
  /**
   * POST `file` to a Convex storage upload URL and resolve with its storage
   * ID. `maxSize` and `allowedTypes` are checked first, like
   * `useConvexFileUpload`'s options.
   */
  upload(
    url: string,
    file: Blob,
    options?: ConvexOperationUploadOptions,
  ): Promise<GenericId<'_storage'>>
}

/** A library-owned request. `dispatch` sends it without awaiting first. */
export interface OperationStep<Result> {
  readonly kind: OperationStepKind
  readonly functionName?: string
  dispatch(signal: AbortSignal): Promise<Result>
}

/** Package-private operation: the public steps plus the generic fenced dispatch. */
export interface InternalOperation extends ConvexOperation {
  /** Why the operation retired (`IDENTITY_CHANGED` or `CANCELLED`), or `null`. */
  readonly retirement: ConvexCallError | null
  /**
   * Steps that were handed to the transport and not proven unsent: settled,
   * failed with a sent or unknown outcome, or still in flight.
   */
  readonly sentSteps: number
  step<Result>(step: OperationStep<Result>): Promise<Result>
  /**
   * The owning work settled. The controller stops holding the operation once
   * its in-flight steps settle, so its `signal` no longer aborts on a later
   * identity change. Each later step still checks the identity before it is sent.
   */
  finish(): void
}

export type OperationClient = Pick<ConvexClientHandle, 'query' | 'mutation' | 'action'>

export interface OperationControllerInput {
  getIdentityGeneration(): number
  subscribeIdentityChange?(listener: () => void): () => void
  /** Settle authentication before a Convex step's identity check. */
  settle?(): Promise<void>
  /** The Convex transport, or `null` where none exists (SSR). */
  readonly client: OperationClient | null
}

export interface OperationController {
  /** Start an operation bound to the identity generation current now. */
  begin(): InternalOperation
  /** Called after operations of a retired identity were retired. */
  onIdentityChange(listener: () => void): () => void
  dispose(): void
}

type Retirement = 'identity' | 'cancel'

interface Flight {
  readonly abortable: boolean
  readonly controller: AbortController
}

interface OperationState {
  readonly generation: number
  retiredBy: Retirement | null
  /** The `signal.reason` of a retired operation. */
  reason: ConvexCallError | null
  /** Created on first `signal` read; a read signal keeps a running operation observed. */
  abort: AbortController | null
  readonly flights: Set<Flight>
  /** See {@link InternalOperation.sentSteps}. */
  sentSteps: number
  /** The owning work settled; see {@link InternalOperation.finish}. */
  finished: boolean
}

function libraryError(
  code: ConvexCallErrorCode,
  message: string,
  functionName?: string,
  outcome?: ConvexCallOutcome,
): ConvexCallError {
  return new ConvexCallError({ kind: 'unknown', code, message, functionName, outcome })
}

function withOutcome(error: ConvexCallError, outcome: ConvexCallOutcome): ConvexCallError {
  if (error.outcome === outcome) return error
  return new ConvexCallError({ ...error.toJSON(), outcome })
}

/**
 * The one identity fence for client-side Convex work. `useConvexOperation`,
 * the mutation and action callables, `useConvexForm`, and
 * `useConvexFileUpload` all dispatch through it.
 *
 * Framework-free: identity observation, authentication settlement, and the
 * Convex transport are injected.
 */
export function createOperationController(input: OperationControllerInput): OperationController {
  const { getIdentityGeneration } = input
  // Operations that must be retired eagerly: a step is in flight, or app code
  // holds the signal of an unfinished operation. Others are checked lazily at
  // their next step.
  const observed = new Set<OperationState>()
  const identityListeners = new Set<() => void>()
  let observedGeneration = getIdentityGeneration()
  let disposed = false

  const retire = (state: OperationState, cause: Retirement) => {
    if (state.retiredBy) return
    state.retiredBy = cause
    observed.delete(state)
    const reason =
      cause === 'identity'
        ? createIdentityChangedError()
        : libraryError(
            'CANCELLED',
            'Convex operation cancelled: it was cancelled or its owner was disposed.',
          )
    state.reason = reason
    for (const flight of [...state.flights]) {
      if (cause === 'identity' || flight.abortable) flight.controller.abort(reason)
    }
    state.abort?.abort(reason)
  }

  /** Retire lazily when the owner is gone or the identity moved on unobserved. */
  const sync = (state: OperationState) => {
    if (state.retiredBy) return
    if (disposed) retire(state, 'cancel')
    else if (getIdentityGeneration() !== state.generation) retire(state, 'identity')
  }

  const retirementError = (
    state: OperationState,
    step: OperationStep<unknown>,
    outcome: ConvexCallOutcome,
  ): ConvexCallError =>
    state.retiredBy === 'identity'
      ? createIdentityChangedError(step.kind, { functionName: step.functionName, outcome })
      : libraryError(
          'CANCELLED',
          outcome === 'not-sent'
            ? `Convex ${step.kind} cancelled before it was sent.`
            : `Convex ${step.kind} cancelled after it was sent; it may have completed.`,
          step.functionName,
          outcome,
        )

  /** Drop an operation nothing needs to retire eagerly any more. */
  const release = (state: OperationState) => {
    if (state.flights.size === 0 && (!state.abort || state.finished)) observed.delete(state)
  }

  const runStep = async <Result>(
    state: OperationState,
    step: OperationStep<Result>,
  ): Promise<Result> => {
    const context = { functionName: step.functionName }
    sync(state)
    if (state.retiredBy) throw retirementError(state, step, 'not-sent')
    if (input.settle && step.kind !== 'upload') {
      try {
        await input.settle()
      } catch (cause) {
        sync(state)
        if (state.retiredBy) throw retirementError(state, step, 'not-sent')
        throw withOutcome(normalizeConvexError(cause, context), 'not-sent')
      }
    }

    // The identity check and the dispatch below run in one synchronous turn.
    sync(state)
    if (state.retiredBy) throw retirementError(state, step, 'not-sent')

    const flight: Flight = { abortable: step.kind === 'upload', controller: new AbortController() }
    state.flights.add(flight)
    observed.add(state)
    const { signal } = flight.controller
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    let sent: Promise<Result>
    try {
      sent = Promise.resolve(step.dispatch(signal))
    } catch (cause) {
      sent = Promise.reject(cause)
    }
    // A retired call may never settle, or settle after the race was decided.
    sent.catch(() => {})
    aborted.catch(() => {})
    // Counted as sent from dispatch until its outcome proves otherwise.
    state.sentSteps += 1

    let settled: { ok: true; value: Result } | { ok: false; cause: unknown }
    try {
      settled = { ok: true, value: await Promise.race([sent, aborted]) }
    } catch (cause) {
      settled = { ok: false, cause }
    } finally {
      state.flights.delete(flight)
      release(state)
    }

    const conclude = (): Result => {
      sync(state)
      // The step was sent; a retirement that aborted it leaves its outcome open.
      if (signal.aborted) throw retirementError(state, step, 'unknown')
      if (state.retiredBy === 'identity') {
        const transportNotSent =
          !settled.ok &&
          isIdentityChangedError(settled.cause) &&
          settled.cause.outcome === 'not-sent'
        throw retirementError(state, step, transportNotSent ? 'not-sent' : 'unknown')
      }
      if (settled.ok) return settled.value
      const normalized = normalizeConvexError(settled.cause, context)
      // The transport's own identity rejection without a recorded outcome was sent.
      if (isIdentityChangedError(normalized) && normalized.outcome === undefined) {
        throw withOutcome(normalized, 'unknown')
      }
      throw normalized
    }
    try {
      return conclude()
    } catch (error) {
      if (error instanceof ConvexCallError && error.outcome === 'not-sent') state.sentSteps -= 1
      throw error
    }
  }

  const begin = (): InternalOperation => {
    const state: OperationState = {
      generation: getIdentityGeneration(),
      retiredBy: null,
      reason: null,
      abort: null,
      flights: new Set(),
      sentSteps: 0,
      finished: false,
    }
    sync(state)

    const convexStep = <Result>(
      kind: 'query' | 'mutation' | 'action',
      reference: FunctionReference<typeof kind>,
      args: readonly unknown[],
    ): Promise<Result> => {
      const functionName = getFunctionName(reference)
      const snapshot = snapshotArgs(args[0] ?? {})
      return runStep(state, {
        kind,
        functionName,
        dispatch: () => {
          const client = input.client
          if (!client) {
            throw libraryError(
              'CLIENT_UNAVAILABLE',
              `No browser Convex client is available to run this ${kind}.`,
              functionName,
              'not-sent',
            )
          }
          const target = client as Record<
            typeof kind,
            (reference: unknown, args: unknown) => Promise<Result>
          >
          return target[kind](reference, snapshot)
        },
      })
    }

    const operation: InternalOperation = {
      get retired() {
        sync(state)
        return state.retiredBy !== null
      },
      get retirement() {
        sync(state)
        return state.reason
      },
      get sentSteps() {
        return state.sentSteps
      },
      get signal() {
        if (!state.abort) {
          state.abort = new AbortController()
          sync(state)
          if (state.retiredBy) state.abort.abort(state.reason)
          else if (!state.finished) observed.add(state)
        }
        return state.abort.signal
      },
      finish() {
        state.finished = true
        release(state)
      },
      cancel() {
        // An identity change that happened first stays the reason.
        sync(state)
        retire(state, 'cancel')
      },
      mutation: (reference, ...args) => convexStep('mutation', reference, args),
      action: (reference, ...args) => convexStep('action', reference, args),
      query: (reference, ...args) => convexStep('query', reference, args),
      upload: (url, file, options) => {
        // The same client-side preflight as useConvexFileUpload: nothing is sent.
        const rejected = options && checkUploadFile(file, options)
        if (rejected) return Promise.reject(rejected)
        return runStep(state, {
          kind: 'upload',
          dispatch: (signal) => {
            if (!canPostFiles()) {
              throw libraryError(
                'CLIENT_UNAVAILABLE',
                'No browser upload transport is available. Upload files from the browser.',
                undefined,
                'not-sent',
              )
            }
            return postFileToConvexStorage(url, file, { signal, onProgress: options?.onProgress })
          },
        })
      },
      step: (step) => runStep(state, step),
    }
    return operation
  }

  const stopIdentity =
    input.subscribeIdentityChange?.(() => {
      const generation = getIdentityGeneration()
      if (generation === observedGeneration) return
      observedGeneration = generation
      for (const state of [...observed]) {
        if (state.generation !== generation) retire(state, 'identity')
      }
      for (const listener of [...identityListeners]) listener()
    }) ?? null

  return {
    begin,
    onIdentityChange(listener) {
      identityListeners.add(listener)
      return () => identityListeners.delete(listener)
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopIdentity?.()
      identityListeners.clear()
      for (const state of [...observed]) retire(state, 'cancel')
    },
  }
}

/** The public view of an operation: its steps and retirement, without the generic dispatch. */
export function toPublicOperation(operation: InternalOperation): ConvexOperation {
  return Object.freeze({
    get retired() {
      return operation.retired
    },
    get signal() {
      return operation.signal
    },
    cancel: () => operation.cancel(),
    mutation: operation.mutation,
    action: operation.action,
    query: operation.query,
    upload: operation.upload,
  })
}
