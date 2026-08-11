import { computed, ref, type ComputedRef } from 'vue'

/** Tracks actual asynchronous Better Auth work without serializing callers. */
export interface AuthOperationTracker {
  readonly isPending: ComputedRef<boolean>
  track<Value>(operation: Promise<Value>): Promise<Value>
}

export function createAuthOperationTracker(): AuthOperationTracker {
  const pendingCount = ref(0)
  const isPending = computed(() => pendingCount.value > 0)

  return {
    isPending,
    track<Value>(operation: Promise<Value>): Promise<Value> {
      pendingCount.value += 1
      return operation.finally(() => {
        pendingCount.value -= 1
      })
    },
  }
}
