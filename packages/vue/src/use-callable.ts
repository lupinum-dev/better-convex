import type { OptimisticLocalStore } from 'convex/browser'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from 'convex/server'
import { getCurrentScope, onScopeDispose, readonly, type ComputedRef, type Ref } from 'vue'

import { ConvexCallError } from './errors'
import type { ClientCallStatus } from './internal/call-state'
import {
  createCallableController,
  type CallableControllerObserver,
} from './internal/callable-controller'
import { useOptionalBetterConvexRuntime } from './runtime-context'

const CALLABLE_OBSERVER_KEY = Symbol.for('better-convex.callable-observer')

export type ConvexCallStatus = ClientCallStatus

export type OptimisticUpdate<Args> = (store: OptimisticLocalStore, args: Args) => undefined

type OptimisticUpdateCandidate<Args> = (store: OptimisticLocalStore, args: Args) => unknown

type ReturnHasThen<Result> = Result extends unknown
  ? 'then' extends keyof Result
    ? true
    : false
  : never

type OptimisticReturnHasThen<Update extends (...args: never[]) => unknown> = ReturnHasThen<
  ReturnType<Update>
>

type SynchronousOptimisticUpdate<Update extends (...args: never[]) => unknown> =
  true extends OptimisticReturnHasThen<Update>
    ? 'Optimistic update handlers must be synchronous'
    : unknown

export type UseConvexMutationOptions<Args> = Readonly<{ optimisticUpdate?: OptimisticUpdate<Args> }>

interface InternalCallableOptions<Args, Result> {
  [CALLABLE_OBSERVER_KEY]?: CallableControllerObserver<Args, Result>
}

export interface UseConvexCall<Reference extends FunctionReference<'mutation' | 'action'>> {
  (...args: OptionalRestArgs<Reference>): Promise<FunctionReturnType<Reference>>
  readonly data: Readonly<Ref<FunctionReturnType<Reference> | undefined>>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  readonly error: Readonly<Ref<ConvexCallError | undefined>>
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
  options?: {
    optimisticUpdate?: OptimisticUpdateCandidate<FunctionArgs<Reference>>
  } & InternalCallableOptions<FunctionArgs<Reference>, FunctionReturnType<Reference>>,
): UseConvexCall<Reference> {
  if (!getCurrentScope()) {
    throw new Error(
      `[better-convex-vue] useConvex${operation === 'mutation' ? 'Mutation' : 'Action'} must run inside a Vue effect scope`,
    )
  }
  type Args = FunctionArgs<Reference>
  type Result = FunctionReturnType<Reference>
  const runtime = useOptionalBetterConvexRuntime()
  const lifecycle = createCallableController<Args, Result>({
    operation,
    getIdentityGeneration: () => runtime?.identity.snapshot.value.identityGeneration ?? 0,
    subscribeIdentityChange: runtime
      ? (listener) => runtime.browser.identity.subscribe(listener)
      : undefined,
    observer: options?.[CALLABLE_OBSERVER_KEY],
    handlers: {
      settle: () => runtime?.browser.ready() ?? Promise.resolve(),
      invoke: async (args) => {
        if (!runtime) {
          throw new ConvexCallError({
            kind: 'unknown',
            message: `[better-convex-vue] useConvex${operation === 'mutation' ? 'Mutation' : 'Action'} cannot execute without an installed browser runtime`,
          })
        }
        if (operation === 'mutation') {
          return (await runtime.browser.handle.mutation(reference as never, args as never, {
            optimisticUpdate: wrapOptimisticUpdate(options?.optimisticUpdate),
          })) as Result
        }
        return (await runtime.browser.handle.action(reference as never, args as never)) as Result
      },
    },
  })
  onScopeDispose(lifecycle.dispose)
  const execute = (...args: OptionalRestArgs<Reference>) => lifecycle.run((args[0] ?? {}) as Args)
  return Object.freeze(
    Object.assign(execute, {
      data: readonly(lifecycle.data),
      status: lifecycle.status,
      pending: lifecycle.pending,
      error: readonly(lifecycle.error),
    }),
  ) as UseConvexCall<Reference>
}

export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseConvexMutationOptions<FunctionArgs<Mutation>>,
): UseConvexCall<Mutation>
export function useConvexMutation<
  Mutation extends FunctionReference<'mutation'>,
  Update extends OptimisticUpdateCandidate<FunctionArgs<Mutation>>,
>(
  mutation: Mutation,
  options: Readonly<{ optimisticUpdate: Update }> & SynchronousOptimisticUpdate<Update>,
): UseConvexCall<Mutation>
export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: {
    optimisticUpdate?: OptimisticUpdateCandidate<FunctionArgs<Mutation>>
  } & InternalCallableOptions<FunctionArgs<Mutation>, FunctionReturnType<Mutation>>,
): UseConvexCall<Mutation> {
  return createCallable('mutation', mutation, options)
}

export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
): UseConvexCall<Action>
export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: InternalCallableOptions<FunctionArgs<Action>, FunctionReturnType<Action>>,
): UseConvexCall<Action> {
  return createCallable('action', action, options)
}
