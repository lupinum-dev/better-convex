import { computed, ref, type ComputedRef, type Ref } from 'vue'

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
  const currentStatus = ref<ClientCallStatus>('idle')
  const error = ref<ConvexCallError | undefined>(undefined) as Ref<ConvexCallError | undefined>
  const data = ref<Result | undefined>(undefined) as Ref<Result | undefined>

  const status = computed(() => currentStatus.value)
  const pending = computed(() => currentStatus.value === 'pending')

  const start = () => {
    const requestId = ++activeRequestId
    currentStatus.value = 'pending'
    error.value = undefined
    data.value = undefined
    return requestId
  }

  const isCurrent = (requestId: number) => requestId === activeRequestId

  const commitSuccess = (requestId: number, result: Result) => {
    if (!isCurrent(requestId)) return false
    currentStatus.value = 'success'
    data.value = result
    return true
  }

  const commitError = (requestId: number, err: ConvexCallError) => {
    if (!isCurrent(requestId)) return false
    currentStatus.value = 'error'
    error.value = err
    return true
  }

  const reset = () => {
    activeRequestId += 1
    currentStatus.value = 'idle'
    error.value = undefined
    data.value = undefined
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
