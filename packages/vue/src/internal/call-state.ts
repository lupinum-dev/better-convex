import { computed, shallowRef, type ComputedRef, type Ref } from 'vue'

import type { ConvexCallError } from '../errors'

export type ClientCallStatus = 'idle' | 'pending' | 'success' | 'error'

export interface ClientCallState<Result> {
  data: Ref<Result | undefined>
  status: ComputedRef<ClientCallStatus>
  pending: ComputedRef<boolean>
  error: Ref<ConvexCallError | undefined>
  start(): number
  isCurrent(requestId: number): boolean
  commitSuccess(requestId: number, result: Result): boolean
  commitError(requestId: number, error: ConvexCallError): boolean
  /** Synchronously mask retained data/error and retire pending work. */
  mask(): void
  reset(): void
}

export function createClientCallState<Result>(): ClientCallState<Result> {
  let activeRequestId = 0
  const currentStatus = shallowRef<ClientCallStatus>('idle')
  // Results stay the exact values Convex returned; a deep ref would hand out proxies.
  const error = shallowRef<ConvexCallError | undefined>(undefined)
  const data = shallowRef<Result | undefined>(undefined)

  const status = computed(() => currentStatus.value)
  const pending = computed(() => currentStatus.value === 'pending')

  const start = () => {
    const requestId = ++activeRequestId
    error.value = undefined
    data.value = undefined
    currentStatus.value = 'pending'
    return requestId
  }

  const isCurrent = (requestId: number) => requestId === activeRequestId

  const commitSuccess = (requestId: number, result: Result) => {
    if (!isCurrent(requestId)) return false
    data.value = result
    error.value = undefined
    currentStatus.value = 'success'
    return true
  }

  const commitError = (requestId: number, err: ConvexCallError) => {
    if (!isCurrent(requestId)) return false
    data.value = undefined
    error.value = err
    currentStatus.value = 'error'
    return true
  }

  const reset = () => {
    activeRequestId += 1
    error.value = undefined
    data.value = undefined
    currentStatus.value = 'idle'
  }

  return {
    data,
    status,
    pending,
    error,
    start,
    isCurrent,
    commitSuccess,
    commitError,
    mask: reset,
    reset,
  }
}
