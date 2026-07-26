import { ConvexCallError } from '../errors'
import type { SessionSynchronizationBarrier } from './integrated-namespace'

interface ActiveBarrier extends SessionSynchronizationBarrier {
  afterRevision: number
  observe(sessionToken: string | null): void
}

export interface SessionSynchronization {
  observe(sessionToken: string | null): void
  createBarrier(): SessionSynchronizationBarrier
  dispose(): void
}

/** Correlates an auth action with the next canonical Better Auth session revision. */
export function createSessionSynchronization(input: {
  timeoutMs: number
  isDisposed: () => boolean
  failClosed: (failure: ConvexCallError) => Promise<void>
}): SessionSynchronization {
  let revision = 0
  const barriers = new Set<ActiveBarrier>()

  function createBarrier(): SessionSynchronizationBarrier {
    let active = true
    let expectedSessionToken: string | null | undefined
    let latestObservedSessionToken: string | null | undefined
    let timer: ReturnType<typeof setTimeout> | null = null
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })

    const finish = () => {
      if (!active) return
      active = false
      if (timer !== null) clearTimeout(timer)
      timer = null
      barriers.delete(barrier)
      resolve()
    }

    const barrier: ActiveBarrier = {
      afterRevision: revision,
      observe(sessionToken) {
        if (!active) return
        latestObservedSessionToken = sessionToken
        if (sessionToken === expectedSessionToken) finish()
      },
      cancel: finish,
      wait(sessionToken) {
        if (!active) return promise
        expectedSessionToken = sessionToken
        if (latestObservedSessionToken === sessionToken) {
          finish()
          return promise
        }
        if (timer !== null) return promise
        timer = setTimeout(() => {
          if (!active) return
          active = false
          timer = null
          barriers.delete(barrier)
          const failure = new ConvexCallError({
            kind: 'authentication',
            code: 'SESSION_RECONCILIATION_TIMEOUT',
            message: 'Better Auth session reconciliation timed out',
          })
          void input.failClosed(failure).then(
            () => reject(failure),
            () => reject(failure),
          )
        }, input.timeoutMs)
        return promise
      },
    }

    if (input.isDisposed()) barrier.cancel()
    else barriers.add(barrier)
    return barrier
  }

  return {
    observe(sessionToken) {
      revision += 1
      for (const barrier of [...barriers]) {
        if (barrier.afterRevision >= revision) continue
        barrier.observe(sessionToken)
      }
    },
    createBarrier,
    dispose() {
      for (const barrier of [...barriers]) barrier.cancel()
      barriers.clear()
    },
  }
}
