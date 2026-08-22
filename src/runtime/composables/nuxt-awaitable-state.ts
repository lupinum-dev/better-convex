/** Attach a reactive composable state to the Promise for its initial settlement. */
export function createNuxtAwaitableState<State extends object>(
  state: State,
  settlement: Promise<unknown>,
): State & Promise<State> {
  const awaitedState = Object.freeze({ ...state }) as State
  const promise = settlement.then(
    () => awaitedState,
    () => awaitedState,
  )

  void Object.assign(promise, state)
  void Object.defineProperties(promise, {
    then: { enumerable: true, value: promise.then.bind(promise) },
    catch: { enumerable: true, value: promise.catch.bind(promise) },
    finally: { enumerable: true, value: promise.finally.bind(promise) },
  })
  return promise as State & Promise<State>
}
