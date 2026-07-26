import { describe, expect, it } from 'vitest'

import { createDevtoolsSink } from '../../src/runtime/devtools/sink'
import { ConvexCallError, normalizeConvexError } from '../../src/runtime/errors'
import { createCallableDevtoolsEvents } from '../../src/runtime/utils/callable-devtools'

describe('callable DevTools adapter', () => {
  it('projects optimistic mutation success through the sink redaction boundary', () => {
    const sink = createDevtoolsSink()
    const events = createCallableDevtoolsEvents<{ authorization: string }, { token: string }>({
      operation: 'mutation',
      fnName: 'notes:rename',
      hasOptimisticUpdate: true,
      getSink: () => sink,
    })

    const event = events.startEvent?.({ authorization: 'secret' }, 10)
    expect(sink.getMutations()).toMatchObject([
      {
        name: 'notes:rename',
        type: 'mutation',
        state: 'optimistic',
        hasOptimisticUpdate: true,
        args: { authorization: '[Redacted]' },
      },
    ])

    events.finishEvent?.(event, { token: 'secret' }, 10)
    expect(sink.getMutations()).toMatchObject([
      {
        state: 'success',
        result: { token: '[Redacted]' },
      },
    ])
  })

  it('projects action failure as pending then error', () => {
    const sink = createDevtoolsSink()
    const events = createCallableDevtoolsEvents<Record<string, never>, never>({
      operation: 'action',
      fnName: 'reports:generate',
      hasOptimisticUpdate: false,
      getSink: () => sink,
    })

    const event = events.startEvent?.({}, 20)
    expect(sink.getMutations()).toMatchObject([
      {
        name: 'reports:generate',
        type: 'action',
        state: 'pending',
        hasOptimisticUpdate: false,
      },
    ])

    events.failEvent?.(
      event,
      new ConvexCallError({ kind: 'unknown', message: 'Action failed' }),
      20,
    )
    expect(sink.getMutations()).toMatchObject([{ state: 'error', error: 'Action failed' }])
  })

  it('never projects an unknown upstream message into DevTools', () => {
    const sentinel = 'DEVTOOLS_ERROR_SECRET_5a91'
    const sink = createDevtoolsSink()
    const events = createCallableDevtoolsEvents<Record<string, never>, never>({
      operation: 'action',
      fnName: 'reports:generate',
      hasOptimisticUpdate: false,
      getSink: () => sink,
    })

    const event = events.startEvent?.({}, 20)
    events.failEvent?.(event, normalizeConvexError(new Error(sentinel)), 20)

    expect(sink.getMutations()).toMatchObject([{ state: 'error', error: 'Unknown Convex error' }])
    expect(JSON.stringify(sink.getMutations())).not.toContain(sentinel)
  })

  it('is inert when no current sink exists', () => {
    const events = createCallableDevtoolsEvents<Record<string, never>, string>({
      operation: 'mutation',
      fnName: 'notes:rename',
      hasOptimisticUpdate: false,
      getSink: () => null,
    })

    const event = events.startEvent?.({}, 1)
    expect(event).toBeUndefined()
    expect(() => events.finishEvent?.(event, 'ok', 1)).not.toThrow()
  })
})
