import { effectScope, watch } from 'vue'

export interface SettlementWaiters {
  /** Resolve once `done()` holds, or when the owning lifecycle is disposed. */
  until(done: () => boolean): Promise<void>
  dispose(): void
}

/**
 * Promise settlement for a composable lifecycle. Each wait observes in its own
 * detached scope, so a caller's unrelated component scope cannot strand it.
 */
export function createSettlementWaiters(): SettlementWaiters {
  const pending = new Set<() => void>()
  let disposed = false

  return {
    until(done) {
      if (disposed || done()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const scope = effectScope(true)
        const finish = () => {
          pending.delete(finish)
          scope.stop()
          resolve()
        }
        pending.add(finish)
        scope.run(() =>
          watch(
            done,
            (ready) => {
              if (ready) finish()
            },
            { flush: 'sync' },
          ),
        )
      })
    },
    dispose() {
      disposed = true
      for (const finish of [...pending]) finish()
    },
  }
}
