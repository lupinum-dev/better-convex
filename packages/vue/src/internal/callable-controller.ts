import type { ComputedRef, Ref } from 'vue'

import { ConvexCallError, normalizeConvexError } from '../errors'
import { createClientCallState, type ClientCallStatus } from './call-state'
import { createIdentityChangedError, isIdentityChangedError } from './identity-changed-error'

export type CallableOperation = 'mutation' | 'action'

export interface CallableControllerHandlers<Args, Result> {
  /** Settle authentication before the operation is bound and dispatched. */
  settle?: () => Promise<void>
  invoke: (args: Args) => Promise<Result>
}

/** Package-private observation seam used by Nuxt DevTools. */
export interface CallableControllerObserver<Args, Result> {
  startEvent(args: Args, startedAt: number): unknown
  finishEvent(event: unknown, result: Result, startedAt: number): void
  failEvent(event: unknown, error: ConvexCallError, startedAt: number): void
}

export interface CallableControllerInput<Args, Result> {
  operation: CallableOperation
  getIdentityGeneration: () => number
  subscribeIdentityChange?: (listener: () => void) => () => void
  handlers: CallableControllerHandlers<Args, Result>
  observer?: CallableControllerObserver<Args, Result>
}

export interface CallableController<Args, Result> {
  run(args: Args): Promise<Result>
  data: Ref<Result | undefined>
  status: ComputedRef<ClientCallStatus>
  pending: ComputedRef<boolean>
  error: Ref<ConvexCallError | undefined>
  reset(): void
  dispose(): void
}

/**
 * Framework-neutral mutation/action lifecycle.
 *
 * A call is bound to the identity generation visible at invocation entry.
 * Authentication settlement may delay dispatch, but it can never rebind an
 * already-started call to a later identity. A settlement-time transition masks
 * provisional state and the call fails before `invoke`. Reset and newer
 * attempts remain final.
 */
export function createCallableController<Args, Result>(
  input: CallableControllerInput<Args, Result>,
): CallableController<Args, Result> {
  const { operation, getIdentityGeneration, handlers } = input
  const callState = createClientCallState<Result>()
  let lastSeenGeneration = getIdentityGeneration()
  let attemptRevision = 0
  let disposed = false
  let stopIdentity: (() => void) | null = null

  const observe = (callback: () => void) => {
    try {
      callback()
    } catch {
      // Diagnostics are non-authoritative and cannot replace the remote outcome.
    }
  }

  const run = async (args: Args): Promise<Result> => {
    const startedAt = Date.now()
    let event: unknown
    if (input.observer) {
      observe(() => {
        event = input.observer!.startEvent(args, startedAt)
      })
    }
    const generation = getIdentityGeneration()
    const attempt = ++attemptRevision
    let requestId = callState.start()

    try {
      if (disposed) {
        throw new ConvexCallError({
          kind: 'unknown',
          code: 'CALL_DISPOSED',
          message: 'Convex callable is no longer active',
        })
      }
      if (handlers.settle) await handlers.settle()

      if (getIdentityGeneration() !== generation) {
        throw createIdentityChangedError(operation)
      }

      // Settlement may mask provisional state without changing identity. Only
      // the latest live attempt may restore it. A reset/newer call increments
      // attemptRevision.
      if (attempt === attemptRevision && !callState.isCurrent(requestId)) {
        requestId = callState.start()
      }
      const result = await handlers.invoke(args)

      if (getIdentityGeneration() !== generation) {
        throw createIdentityChangedError(operation)
      }

      callState.commitSuccess(requestId, result)
      if (input.observer) {
        observe(() => input.observer!.finishEvent(event, result, startedAt))
      }
      return result
    } catch (rawError) {
      const normalized = normalizeConvexError(rawError)
      const stale = isIdentityChangedError(normalized) || getIdentityGeneration() !== generation

      if (stale) {
        if (callState.isCurrent(requestId)) callState.mask()
        const identityError = isIdentityChangedError(normalized)
          ? normalized
          : createIdentityChangedError(operation)
        if (input.observer) {
          observe(() => input.observer!.failEvent(event, identityError, startedAt))
        }
        throw identityError
      }

      callState.commitError(requestId, normalized)
      if (input.observer) {
        observe(() => input.observer!.failEvent(event, normalized, startedAt))
      }
      throw normalized
    }
  }

  const onIdentityMaybeChanged = () => {
    const generation = getIdentityGeneration()
    if (generation === lastSeenGeneration) return
    lastSeenGeneration = generation
    callState.mask()
  }

  stopIdentity = input.subscribeIdentityChange?.(onIdentityMaybeChanged) ?? null

  const reset = () => {
    attemptRevision += 1
    callState.reset()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    attemptRevision += 1
    stopIdentity?.()
    stopIdentity = null
    callState.mask()
  }

  return {
    run,
    data: callState.data,
    status: callState.status,
    pending: callState.pending,
    error: callState.error,
    reset,
    dispose,
  }
}
