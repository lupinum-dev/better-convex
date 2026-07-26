import type { OptimisticLocalStore } from 'convex/browser'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from 'convex/server'
import { getCurrentScope, onScopeDispose, type ComputedRef, type Ref } from 'vue'

import { ConvexCallError, type CallResult } from './errors'
import type { ClientCallStatus } from './internal/call-state'
import { createCallableController } from './internal/callable-controller'
import { useOptionalBetterConvexRuntime } from './runtime-context'

interface CallableOptions<Args, Result> {
  onSuccess?: (result: Result, args: Args) => void
  onError?: (error: ConvexCallError, args: Args) => void
}

export interface UseConvexMutationOptions<Args, Result> extends CallableOptions<Args, Result> {
  optimisticUpdate?: (store: OptimisticLocalStore, args: Args) => void
}

export type UseConvexActionOptions<Args, Result> = CallableOptions<Args, Result>

export type UseConvexCallableReturn<Reference extends FunctionReference<'mutation' | 'action'>> = ((
  ...args: OptionalRestArgs<Reference>
) => Promise<FunctionReturnType<Reference>>) & {
  safe: (...args: OptionalRestArgs<Reference>) => Promise<CallResult<FunctionReturnType<Reference>>>
  data: Ref<FunctionReturnType<Reference> | undefined>
  status: ComputedRef<ClientCallStatus>
  pending: ComputedRef<boolean>
  error: Ref<ConvexCallError | null>
  reset(): void
}

function createCallable<Reference extends FunctionReference<'mutation' | 'action'>>(
  operation: 'mutation' | 'action',
  reference: Reference,
  options?: UseConvexMutationOptions<FunctionArgs<Reference>, FunctionReturnType<Reference>>,
): UseConvexCallableReturn<Reference> {
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
            optimisticUpdate: options?.optimisticUpdate,
          })) as Result
        }
        return (await runtime.browser.handle.action(reference as never, args as never)) as Result
      },
      onSuccess: options?.onSuccess,
      onError: options?.onError,
    },
  })
  onScopeDispose(lifecycle.dispose)
  const execute = (...args: OptionalRestArgs<Reference>) => lifecycle.run((args[0] ?? {}) as Args)
  const safe = (...args: OptionalRestArgs<Reference>) => lifecycle.safe((args[0] ?? {}) as Args)
  return Object.assign(execute, {
    safe,
    data: lifecycle.data,
    status: lifecycle.status,
    pending: lifecycle.pending,
    error: lifecycle.error,
    reset: lifecycle.reset,
  }) as UseConvexCallableReturn<Reference>
}

export function useConvexMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseConvexMutationOptions<FunctionArgs<Mutation>, FunctionReturnType<Mutation>>,
): UseConvexCallableReturn<Mutation> {
  return createCallable('mutation', mutation, options)
}

export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: UseConvexActionOptions<FunctionArgs<Action>, FunctionReturnType<Action>>,
): UseConvexCallableReturn<Action> {
  return createCallable('action', action, options)
}
