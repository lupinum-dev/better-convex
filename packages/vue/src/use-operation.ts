import { computed, getCurrentScope, onScopeDispose, type ComputedRef } from 'vue'

import type { ConvexCallError } from './errors'
import { createCallableController } from './internal/callable-controller'
import {
  createOperationController,
  toPublicOperation,
  type ConvexOperation,
  type OperationController,
} from './internal/operation-controller'
import { useOptionalBetterConvexRuntime } from './runtime-context'
import type { ConvexCallStatus } from './use-callable'

export type { ConvexOperation, ConvexOperationUploadOptions } from './internal/operation-controller'

/**
 * The work of one operation: send each Convex call and upload through
 * `operation`. Its arguments are the arguments of `run()`.
 */
export type ConvexOperationWork<Args extends unknown[], Result> = (
  operation: ConvexOperation,
  ...args: Args
) => Promise<Result>

/**
 * The state refs and verb returned by {@link useConvexOperation}.
 *
 * `data` and `error` hold the exact values of the latest run, not reactive
 * proxies. Only the newest run owns state; `reset()` and identity changes
 * retire older runs.
 */
export interface UseConvexOperationReturn<Args extends unknown[], Result> {
  /**
   * Starts a new operation for the signed-in identity that is current now and
   * runs the work with it. Resolves with the work's result and rejects with a
   * {@link ConvexCallError}. An identity change rejects it with
   * `IDENTITY_CHANGED`; `error.outcome` tells whether the failing step was sent.
   */
  readonly run: (...args: Args) => Promise<Result>
  /** The latest successful result, or `undefined`. */
  readonly data: ComputedRef<Result | undefined>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  /** The latest failure, or `undefined`. An identity change never shows here. */
  readonly error: ComputedRef<ConvexCallError | undefined>
  /**
   * Returns to `idle`, clears `data` and `error`, and cancels every running
   * operation: a step not yet sent is never sent, a running `upload()` is
   * aborted, and a Convex call already sent settles with its real result.
   */
  readonly reset: () => void
}

/**
 * The shared identity fence behind every client-side write composable, bound
 * to the calling Vue scope. Package-private: the callables, `useConvexForm`,
 * and `useConvexFileUpload` build on it.
 */
export function useOperationController(composable: string): OperationController {
  if (!getCurrentScope()) {
    throw new Error(`[better-convex-vue] ${composable} must run inside a Vue effect scope`)
  }
  // Setup is allowed without a browser runtime (SSR); dispatching is not.
  const runtime = useOptionalBetterConvexRuntime()
  const identity = runtime?.browser.identity
  const controller = createOperationController({
    getIdentityGeneration: () => identity?.snapshot().identityGeneration ?? 0,
    subscribeIdentityChange: identity ? (listener) => identity.subscribe(listener) : undefined,
    settle: runtime ? () => runtime.browser.ready() : undefined,
    client: runtime?.browser.handle ?? null,
  })
  onScopeDispose(controller.dispose)
  return controller
}

/**
 * Run several Convex steps as one operation that belongs to one signed-in
 * identity, with the same reactive state as `useConvexAction`.
 *
 * Each `run()` starts a new operation bound to the identity that is current
 * when it is called. Each step (`mutation`, `action`, `query`, `upload`) checks
 * that identity immediately before it sends its request. When the identity
 * changed first, the step rejects with `IDENTITY_CHANGED` and
 * `outcome: 'not-sent'` and nothing is sent. When it changes while the step is
 * in flight, the step rejects with `IDENTITY_CHANGED` and
 * `outcome: 'unknown'`: it may have committed.
 *
 * An identity change also returns the state to `idle`, so a result or error
 * of the previous user never stays on screen. The operation retires on an
 * identity change, on `op.cancel()`, on `reset()`, and when the calling scope
 * is disposed. Pass `op.signal` to your own async work, or read `op.retired`,
 * to stop it too.
 *
 * ```ts
 * import { useConvexOperation } from '@lupinum/better-convex-vue/experimental'
 *
 * const { run: publish, pending, error } = useConvexOperation(
 *   async (op, draftId: Id<'drafts'>) => {
 *     const draft = await op.query(api.drafts.get, { draftId })
 *     const preview = await fetch(renderUrl(draft), { signal: op.signal })
 *     return op.mutation(api.posts.publish, { draftId, preview: await preview.text() })
 *   },
 * )
 * ```
 *
 * Retrying a failed write is only safe when the application makes it
 * idempotent. Must run inside a Vue effect scope.
 */
export function useConvexOperation<Args extends unknown[], Result>(
  work: ConvexOperationWork<Args, Result>,
): UseConvexOperationReturn<Args, Result> {
  const operations = useOperationController('useConvexOperation')
  const lifecycle = createCallableController<Args, Result>({
    operation: 'operation',
    operations,
    invoke: (operation, args) => work(toPublicOperation(operation), ...args),
  })
  onScopeDispose(lifecycle.dispose)
  // Computed, like every composable's state: read-only, and the exact result
  // and error the run settled with rather than deep `readonly()` proxies.
  return {
    run: (...args: Args) => lifecycle.run(args),
    data: computed(() => lifecycle.data.value),
    status: lifecycle.status,
    pending: lifecycle.pending,
    error: computed(() => lifecycle.error.value),
    reset: lifecycle.reset,
  }
}
