import { computed, ref, type ComputedRef } from 'vue'

/** Tracks actual asynchronous Better Auth work without serializing callers. */
export interface AuthOperationTracker {
  readonly pending: ComputedRef<boolean>
  track<Value>(operation: Promise<Value>): Promise<Value>
}

export function createAuthOperationTracker(): AuthOperationTracker {
  const pendingCount = ref(0)
  const pending = computed(() => pendingCount.value > 0)

  return {
    pending,
    track<Value>(operation: Promise<Value>): Promise<Value> {
      pendingCount.value += 1
      return operation.finally(() => {
        pendingCount.value -= 1
      })
    },
  }
}
