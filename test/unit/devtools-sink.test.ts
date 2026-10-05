import { describe, expect, it, vi } from 'vitest'

import { createDevtoolsSink } from '../../src/runtime/devtools/sink'

function pendingMutation(name: string, args: Record<string, unknown> = {}, startedAt = 1) {
  return {
    name,
    type: 'mutation' as const,
    args,
    state: 'pending' as const,
    hasOptimisticUpdate: false,
    startedAt,
  }
}

describe('createDevtoolsSink', () => {
  it('keeps application instances isolated and redacts values before publication', () => {
    const first = createDevtoolsSink()
    const second = createDevtoolsSink()

    const id = first.registerMutation(
      pendingMutation('notes:create', { authorization: 'private', title: 'Visible' }),
    )
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
      sink.registerMutation(pendingMutation(`mutation:${index}`, {}, index))
    }
    expect(sink.getMutations()).toHaveLength(50)

    sink.dispose()
    expect(sink.getMutations()).toEqual([])
    const callsBefore = subscriber.mock.calls.length
    sink.registerMutation(pendingMutation('after-dispose'))
    expect(subscriber).toHaveBeenCalledTimes(callsBefore)
  })

  it('publishes independent snapshots that cannot mutate stored diagnostics', () => {
    const sink = createDevtoolsSink()
    const id = sink.registerMutation(
      pendingMutation('notes:create', { nested: { title: 'Original' } }),
    )

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

    const byId = (id: string) => sink.getQueries().find((query) => query.id === id)
    sink.updateQuery(firstId, { status: 'success', data: ['first'] })
    expect(byId(firstId)).toMatchObject({ status: 'success', data: ['first'] })
    expect(byId(secondId)).toMatchObject({ status: 'pending' })

    sink.removeQuery(firstId)
    expect(sink.getQueries()).toHaveLength(1)
    expect(byId(secondId)).toBeDefined()
  })
})
