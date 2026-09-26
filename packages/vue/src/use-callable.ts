import type { OptimisticLocalStore } from 'convex/browser'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from 'convex/server'
import { getCurrentScope, onScopeDispose, shallowReadonly, type ComputedRef, type Ref } from 'vue'

import { ConvexCallError } from './errors'
import type { ClientCallStatus } from './internal/call-state'
import {
  createCallableController,
  type CallableControllerObserver,
} from './internal/callable-controller'
import { useOptionalBetterConvexRuntime } from './runtime-context'

export type ConvexCallStatus = ClientCallStatus

export type OptimisticUpdate<Args> = (store: OptimisticLocalStore, args: Args) => undefined

type OptimisticUpdateCandidate<Args> = (store: OptimisticLocalStore, args: Args) => unknown

export type UseConvexMutationOptions<Args> = Readonly<{ optimisticUpdate?: OptimisticUpdate<Args> }>

/** Adapter options for the one callable lifecycle; `observer` feeds Nuxt DevTools. */
export interface ConvexCallableInternalOptions<Args, Result> {
  readonly optimisticUpdate?: OptimisticUpdateCandidate<Args>
  readonly observer?: CallableControllerObserver<Args, Result>
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
  options?: ConvexCallableInternalOptions<FunctionArgs<Reference>, FunctionReturnType<Reference>>,
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
    observer: options?.observer,
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
  // Shallow: `readonly()` would hand out deep proxies instead of the exact
  // result and error the call settled with.
  return Object.freeze(
    Object.assign(execute, {
      data: shallowReadonly(lifecycle.data),
      status: lifecycle.status,
      pending: lifecycle.pending,
      error: shallowReadonly(lifecycle.error),
    }),
  ) as UseConvexCall<Reference>
}

export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseConvexMutationOptions<FunctionArgs<Mutation>>,
): UseConvexCall<Mutation> {
  return createCallable('mutation', mutation, { optimisticUpdate: options?.optimisticUpdate })
}

export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
): UseConvexCall<Action> {
  return createCallable('action', action)
}

/** Adapter entry for {@link useConvexMutation}; the same lifecycle plus an observer. */
export function useConvexMutationInternal<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: ConvexCallableInternalOptions<FunctionArgs<Mutation>, FunctionReturnType<Mutation>>,
): UseConvexCall<Mutation> {
  return createCallable('mutation', mutation, options)
}

/** Adapter entry for {@link useConvexAction}; the same lifecycle plus an observer. */
export function useConvexActionInternal<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: Pick<
    ConvexCallableInternalOptions<FunctionArgs<Action>, FunctionReturnType<Action>>,
    'observer'
  >,
): UseConvexCall<Action> {
  return createCallable('action', action, options)
}
