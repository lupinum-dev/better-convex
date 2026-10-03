import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { computed, onScopeDispose, type ComputedRef } from 'vue'

import { ConvexCallError, type ConvexCallErrorCode } from './errors'
import type { ClientCallStatus } from './internal/call-state'
import {
  createCallableController,
  type CallableControllerObserver,
} from './internal/callable-controller'
import type { ConvexArgsInput } from './internal/query-args'
import { snapshotArgs } from './internal/snapshot-args'
import { useOptionalBetterConvexRuntime } from './runtime-context'
import { useOperationController } from './use-operation'

export type ConvexCallStatus = ClientCallStatus

/**
 * The arguments of `mutate()` and `run()`: like query arguments, each
 * top-level field may be a ref. The call reads them once and sends a snapshot.
 */
export type ConvexCallArgs<Reference extends FunctionReference<'mutation' | 'action'>> =
  FunctionArgs<Reference> extends Record<string, never>
    ? [args?: ConvexArgsInput<FunctionArgs<Reference>>]
    : [args: ConvexArgsInput<FunctionArgs<Reference>>]

export type OptimisticUpdate<Args> = (store: OptimisticLocalStore, args: Args) => undefined

type OptimisticUpdateCandidate<Args> = (store: OptimisticLocalStore, args: Args) => unknown

export type UseConvexMutationOptions<Args> = Readonly<{ optimisticUpdate?: OptimisticUpdate<Args> }>

/** Adapter options for the one callable lifecycle; `observer` feeds Nuxt DevTools. */
export interface ConvexCallableInternalOptions<Args, Result> {
  readonly optimisticUpdate?: OptimisticUpdateCandidate<Args>
  readonly observer?: CallableControllerObserver<Args, Result>
}

/**
 * The state refs and verb returned by {@link useConvexMutation}.
 *
 * `data` and `error` hold the exact values of the latest call, not reactive
 * proxies. Only the newest call owns state; `reset()` and identity changes
 * retire older calls.
 */
export interface UseConvexMutationReturn<Mutation extends FunctionReference<'mutation'>> {
  /**
   * Runs the mutation. Resolves with its result and rejects with a
   * {@link ConvexCallError} that carries the function name. An identity
   * change rejects it with `IDENTITY_CHANGED`; `error.outcome` tells whether
   * it was sent.
   */
  readonly mutate: (...args: ConvexCallArgs<Mutation>) => Promise<FunctionReturnType<Mutation>>
  /** The latest successful result, or `undefined`. */
  readonly data: ComputedRef<FunctionReturnType<Mutation> | undefined>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  /** The latest failure, or `undefined`. */
  readonly error: ComputedRef<ConvexCallError | undefined>
  /**
   * Returns to `idle` and clears `data` and `error`. A call not yet sent is
   * never sent: it rejects with `CANCELLED` and `outcome: 'not-sent'`. A call
   * already sent still settles its own promise but no longer updates this state.
   */
  readonly reset: () => void
}

/**
 * The state refs and verb returned by {@link useConvexAction}.
 *
 * `data` and `error` hold the exact values of the latest call, not reactive
 * proxies. Only the newest call owns state; `reset()` and identity changes
 * retire older calls.
 */
export interface UseConvexActionReturn<Action extends FunctionReference<'action'>> {
  /**
   * Runs the action. Resolves with its result and rejects with a
   * {@link ConvexCallError} that carries the function name. An identity
   * change rejects it with `IDENTITY_CHANGED`; `error.outcome` tells whether
   * it was sent.
   */
  readonly run: (...args: ConvexCallArgs<Action>) => Promise<FunctionReturnType<Action>>
  /** The latest successful result, or `undefined`. */
  readonly data: ComputedRef<FunctionReturnType<Action> | undefined>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  /** The latest failure, or `undefined`. */
  readonly error: ComputedRef<ConvexCallError | undefined>
  /**
   * Returns to `idle` and clears `data` and `error`. A call not yet sent is
   * never sent: it rejects with `CANCELLED` and `outcome: 'not-sent'`. A call
   * already sent still settles its own promise but no longer updates this state.
   */
  readonly reset: () => void
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function wrapOptimisticUpdate<Args>(
  update: OptimisticUpdateCandidate<Args> | undefined,
): OptimisticUpdate<Args> | undefined {
  if (!update) return undefined
  return (store, args) => {
    const result: unknown = update(store, args)
    if (isPromiseLike(result)) {
      console.warn(
        '[better-convex-vue] optimisticUpdate returned a Promise-like value. Optimistic updates must be synchronous.',
      )
    }
    return undefined
  }
}

function createCallable<Reference extends FunctionReference<'mutation' | 'action'>>(
  operation: 'mutation' | 'action',
  reference: Reference,
  options?: ConvexCallableInternalOptions<FunctionArgs<Reference>, FunctionReturnType<Reference>>,
) {
  const composable = operation === 'mutation' ? 'useConvexMutation' : 'useConvexAction'
  type Args = FunctionArgs<Reference>
  type Result = FunctionReturnType<Reference>
  const operations = useOperationController(composable)
  const functionName = getFunctionName(reference)
  const runtime = useOptionalBetterConvexRuntime()
  const optimisticUpdate = wrapOptimisticUpdate(options?.optimisticUpdate)
  const lifecycle = createCallableController<Args, Result>({
    operation,
    functionName,
    operations,
    observer: options?.observer,
    invoke: (call, args) =>
      call.step({
        kind: operation,
        functionName,
        dispatch: async () => {
          if (!runtime) {
            throw new ConvexCallError({
              kind: 'unknown',
              code: 'CLIENT_UNAVAILABLE' satisfies ConvexCallErrorCode,
              message: `[better-convex-vue] ${composable} cannot execute without an installed browser runtime`,
              functionName,
              outcome: 'not-sent',
            })
          }
          const handle = runtime.browser.handle
          if (operation === 'mutation') {
            return (await handle.mutation(reference as never, args as never, {
              optimisticUpdate,
            })) as Result
          }
          return (await handle.action(reference as never, args as never)) as Result
        },
      }),
  })
  onScopeDispose(lifecycle.dispose)
  // Computed, like every composable's state: read-only, and the exact result
  // and error the call settled with rather than deep `readonly()` proxies.
  return {
    call: (...args: ConvexCallArgs<Reference>): Promise<Result> =>
      lifecycle.run(snapshotArgs((args[0] ?? {}) as Args)),
    data: computed(() => lifecycle.data.value),
    status: lifecycle.status,
    pending: lifecycle.pending,
    error: computed(() => lifecycle.error.value),
    reset: lifecycle.reset,
  }
}

/**
 * Binds a Convex mutation to reactive call state.
 *
 * ```ts
 * const { mutate, pending, error } = useConvexMutation(api.notes.create)
 * await mutate({ title: 'Hello' })
 * ```
 *
 * Must run inside a Vue effect scope. `optimisticUpdate` must be synchronous.
 */
export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseConvexMutationOptions<FunctionArgs<Mutation>>,
): UseConvexMutationReturn<Mutation> {
  return useConvexMutationInternal(mutation, { optimisticUpdate: options?.optimisticUpdate })
}

/**
 * Binds a Convex action to reactive call state.
 *
 * ```ts
 * const { run, pending, error } = useConvexAction(api.reports.generate)
 * await run({ month: '2026-09' })
 * ```
 *
 * Must run inside a Vue effect scope.
 */
export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
): UseConvexActionReturn<Action> {
  return useConvexActionInternal(action)
}

/** Adapter entry for {@link useConvexMutation}; the same lifecycle plus an observer. */
export function useConvexMutationInternal<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: ConvexCallableInternalOptions<FunctionArgs<Mutation>, FunctionReturnType<Mutation>>,
): UseConvexMutationReturn<Mutation> {
  const { call, ...state } = createCallable('mutation', mutation, options)
  return { mutate: call, ...state }
}

/** Adapter entry for {@link useConvexAction}; the same lifecycle plus an observer. */
export function useConvexActionInternal<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: Pick<
    ConvexCallableInternalOptions<FunctionArgs<Action>, FunctionReturnType<Action>>,
    'observer'
  >,
): UseConvexActionReturn<Action> {
  const { call, ...state } = createCallable('action', action, options)
  return { run: call, ...state }
}
