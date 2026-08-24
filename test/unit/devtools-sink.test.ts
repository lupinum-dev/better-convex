import { describe, expect, it, vi } from 'vitest'

import { createDevtoolsSink } from '../../src/runtime/devtools/sink'

describe('createDevtoolsSink', () => {
  it('keeps application instances isolated and redacts values before publication', () => {
    const first = createDevtoolsSink()
    const second = createDevtoolsSink()

    const id = first.registerMutation({
      name: 'notes:create',
      type: 'mutation',
      args: { authorization: 'private', title: 'Visible' },
      state: 'pending',
      hasOptimisticUpdate: false,
      startedAt: 1,
    })
    first.updateMutation(id, { state: 'success', result: { sessionToken: 'private' } })

    expect(second.getMutations()).toEqual([])
    expect(first.getMutations()).toMatchObject([
      {
        args: { authorization: '[Redacted]', title: 'Visible' },
        result: { sessionToken: '[Redacted]' },
      },
    ])

    first.clearIdentityOwned()
    expect(first.getMutations()).toEqual([])
  })

  it('bounds mutation history and releases subscribers and state on disposal', () => {
    const sink = createDevtoolsSink()
    const subscriber = vi.fn()
    sink.subscribeToMutations(subscriber)

    for (let index = 0; index < 55; index += 1) {
      sink.registerMutation({
        name: `mutation:${index}`,
        type: 'mutation',
        args: {},
        state: 'pending',
        hasOptimisticUpdate: false,
        startedAt: index,
      })
    }
    expect(sink.getMutations()).toHaveLength(50)

    sink.dispose()
    expect(sink.getMutations()).toEqual([])
    const callsBefore = subscriber.mock.calls.length
    sink.registerMutation({
      name: 'after-dispose',
      type: 'mutation',
      args: {},
      state: 'pending',
      hasOptimisticUpdate: false,
      startedAt: 100,
    })
    expect(subscriber).toHaveBeenCalledTimes(callsBefore)
  })

  it('publishes independent snapshots that cannot mutate stored diagnostics', () => {
    const sink = createDevtoolsSink()
    const id = sink.registerMutation({
      name: 'notes:create',
      type: 'mutation',
      args: { nested: { title: 'Original' } },
      state: 'pending',
      hasOptimisticUpdate: false,
      startedAt: 1,
    })

    const first = sink.getMutations()
    const firstArgs = first[0]!.args as { nested: { title: string } }
    expect(Reflect.set(firstArgs.nested, 'title', 'Changed')).toBe(false)
    expect(Reflect.set(firstArgs.nested, 'extra', 'Changed')).toBe(true)

    expect(sink.getMutations()[0]).toMatchObject({
      id,
      args: { nested: { title: 'Original' } },
    })
    expect(sink.getMutations()[0]!.args).not.toHaveProperty('nested.extra')
  })

  it('tracks identical query controllers independently', () => {
    const sink = createDevtoolsSink()
    const entry = {
      logicalKey: 'convex:query:notes:list:{}',
      name: 'notes:list',
      args: {},
      status: 'pending' as const,
      data: undefined,
      options: {
        auth: 'required' as const,
        immediate: true,
        lazy: false,
        server: true,
        subscribe: true,
      },
    }

    const firstId = sink.registerQuery(entry)
    const secondId = sink.registerQuery(entry)

    expect(firstId).not.toBe(secondId)
    expect(sink.getQueries()).toHaveLength(2)
    expect(sink.getQueries().map(({ logicalKey }) => logicalKey)).toEqual([
      entry.logicalKey,
      entry.logicalKey,
    ])

    sink.updateQuery(firstId, { status: 'success', data: ['first'] })
    expect(sink.getQuery(firstId)).toMatchObject({ status: 'success', data: ['first'] })
    expect(sink.getQuery(secondId)).toMatchObject({ status: 'pending' })

    sink.removeQuery(firstId)
    expect(sink.getQueries()).toHaveLength(1)
    expect(sink.getQuery(secondId)).toBeDefined()
  })
})
