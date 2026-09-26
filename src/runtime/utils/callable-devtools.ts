import type { CallableControllerObserver } from '@lupinum/better-convex-vue/internal'

import type { DevtoolsSink } from '../devtools/sink'

interface CallableDevtoolsEvent {
  sink: DevtoolsSink
  id: string
}

export function createCallableDevtoolsEvents<Args, Result>(input: {
  operation: 'mutation' | 'action'
  fnName: string
  hasOptimisticUpdate: boolean
  getSink: () => DevtoolsSink | null
}): CallableControllerObserver<Args, Result> {
  return {
    startEvent(args, startedAt): CallableDevtoolsEvent | undefined {
      try {
        const sink = input.getSink()
        if (!sink) return undefined
        const id = sink.registerMutation({
          name: input.fnName,
          type: input.operation,
          args,
          state:
            input.operation === 'mutation' && input.hasOptimisticUpdate ? 'optimistic' : 'pending',
          hasOptimisticUpdate: input.hasOptimisticUpdate,
          startedAt,
        })
        return id ? { sink, id } : undefined
      } catch {
        return undefined
      }
    },
    finishEvent(rawEvent, result, startedAt) {
      const event = rawEvent as CallableDevtoolsEvent | undefined
      if (!event) return
      try {
        const settledAt = Date.now()
        event.sink.updateMutation(event.id, {
          state: 'success',
          result,
          settledAt,
          duration: settledAt - startedAt,
        })
      } catch {
        // Diagnostics are non-authoritative.
      }
    },
    failEvent(rawEvent, error, startedAt) {
      const event = rawEvent as CallableDevtoolsEvent | undefined
      if (!event) return
      try {
        const settledAt = Date.now()
        event.sink.updateMutation(event.id, {
          state: 'error',
          error: error.message,
          settledAt,
          duration: settledAt - startedAt,
        })
      } catch {
        // Diagnostics are non-authoritative.
      }
    },
  }
}
