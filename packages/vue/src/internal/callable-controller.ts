import type { ComputedRef, Ref } from 'vue'

import { ConvexCallError, normalizeConvexError, type ConvexCallErrorCode } from '../errors'
import { createClientCallState, type ClientCallStatus } from './call-state'
import { isIdentityChangedError } from './identity-changed-error'
import type { InternalOperation, OperationController } from './operation-controller'

export type CallableOperation = 'mutation' | 'action' | 'operation'

/** Package-private observation seam used by Nuxt DevTools. */
export interface CallableControllerObserver<Args, Result> {
  startEvent(args: Args, startedAt: number): unknown
  finishEvent(event: unknown, result: Result, startedAt: number): void
  failEvent(event: unknown, error: ConvexCallError, startedAt: number): void
}

export interface CallableControllerInput<Args, Result> {
  operation: CallableOperation
  /** The Convex function path, attached to every rejection this controller produces. */
  functionName?: string
  /** The identity fence; the callable disposes it with itself. */
  operations: OperationController
  /** Send one call as a step of `operation`. */
  invoke: (operation: InternalOperation, args: Args) => Promise<Result>
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
 * Mutation, action, and operation call state over the shared operation fence.
 *
 * Each call is one operation, bound to the identity visible at invocation
 * entry; the fence rejects it with `IDENTITY_CHANGED` when that identity
 * changes before or while it runs. `reset()` and newer calls are final for
 * state: a retired call still settles its own promise but never commits state.
 * `reset()` also cancels every unsettled call, so a step not yet sent is never
 * sent; a step already sent settles with its real result.
 */
export function createCallableController<Args, Result>(
  input: CallableControllerInput<Args, Result>,
): CallableController<Args, Result> {
  const { operation, functionName, operations } = input
  const errorContext = { functionName }
  const callState = createClientCallState<Result>()
  const active = new Set<InternalOperation>()
  let disposed = false

  const observe = (callback: () => void) => {
    try {
      callback()
    } catch {
      // Diagnostics are non-authoritative and cannot replace the remote outcome.
    }
  }

  const run = async (args: Args): Promise<Result> => {
    // A disposed callable has no owner left to observe state or DevTools.
    if (disposed) {
      throw new ConvexCallError({
        kind: 'unknown',
        code: 'CANCELLED' satisfies ConvexCallErrorCode,
        message: `Convex ${operation} cancelled: its owning scope was disposed.`,
        functionName,
        outcome: 'not-sent',
      })
    }
    const startedAt = Date.now()
    let event: unknown
    if (input.observer) {
      observe(() => {
        event = input.observer!.startEvent(args, startedAt)
      })
    }
    const call = operations.begin()
    active.add(call)
    const requestId = callState.start()

    try {
      const result = await input.invoke(call, args)
      callState.commitSuccess(requestId, result)
      if (input.observer) {
        observe(() => input.observer!.finishEvent(event, result, startedAt))
      }
      return result
    } catch (rawError) {
      const error = normalizeConvexError(rawError, errorContext)
      // Identity-owned state never shows a retired identity's outcome, and a
      // library cancellation is the caller's intent, not a failure. An
      // application error that uses the code CANCELLED stays an error.
      if (
        (error.code === 'CANCELLED' && error.kind !== 'server') ||
        isIdentityChangedError(error)
      ) {
        if (callState.isCurrent(requestId)) callState.mask()
      } else {
        callState.commitError(requestId, error)
      }
      if (input.observer) {
        observe(() => input.observer!.failEvent(event, error, startedAt))
      }
      throw error
    } finally {
      active.delete(call)
      call.finish()
    }
  }

  const reset = () => {
    callState.reset()
    for (const call of [...active]) call.cancel()
  }

  const stopIdentity = operations.onIdentityChange(() => callState.mask())

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopIdentity()
    operations.dispose()
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
