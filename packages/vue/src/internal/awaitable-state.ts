/** Composable state that `await` resolves once its first result or error exists. */
export type AwaitableState<State> = State & PromiseLike<State>

/**
 * Attach `then` to a composable's state. It stays a plain object instead of a
 * Promise, because `reactive()` refuses Promises. Awaiting it never rejects:
 * failures land in the state's `error`.
 */
export function createAwaitableState<State extends object>(
  state: State,
  settlement: Promise<unknown>,
): AwaitableState<State> {
  const settled = settlement.then(
    () => state,
    () => state,
  )
  const then: PromiseLike<State>['then'] = (onFulfilled, onRejected) =>
    settled.then(onFulfilled, onRejected)
  return { ...state, then }
}
