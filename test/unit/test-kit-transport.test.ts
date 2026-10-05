import { makeFunctionReference } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createTestTransport,
  exactQueryMatcher,
  drainMicrotasks,
} from '../../packages/vue/src/test/transport'

const query = makeFunctionReference<'query'>('notes:list')
const mutation = makeFunctionReference<'mutation'>('notes:create')

describe('test-kit client contract', () => {
  it('rejects optimistic options before recording a mutation', async () => {
    const transport = createTestTransport()
    const updater = vi.fn()
    transport.configureWrite(transport.writeRecord('mutation', mutation), {
      state: 'resolved',
      value: 'created',
    })
    await expect(
      transport.createClient().mutation(mutation, {}, { optimisticUpdate: updater }),
    ).rejects.toThrow('The Better Convex test kit does not run optimistic updates')
    expect(transport.writeRecord('mutation', mutation).requests).toEqual([])
    expect(updater).not.toHaveBeenCalled()
  })

  it('reads cached values only from subscriptions on the owning client', async () => {
    const transport = createTestTransport()
    const first = transport.createClient()
    const second = transport.createClient()
    const firstSubscription = first.onUpdate(query, {}, () => {})
    transport.configureQuery(transport.queryRecord(exactQueryMatcher('notes:list', {})), {
      state: 'resolved',
      value: ['first'],
    })
    const secondSubscription = second.onUpdate(query, {}, () => {})
    const sameClientSubscription = first.onUpdate(query, {}, () => {})
    expect(firstSubscription.getCurrentValue()).toEqual(['first'])
    expect(sameClientSubscription.getCurrentValue()).toEqual(['first'])
    expect(secondSubscription.getCurrentValue()).toBeUndefined()
    await drainMicrotasks()
    expect(secondSubscription.getCurrentValue()).toEqual(['first'])
    await first.close()
    await second.close()
  })

  it('throws a cached error from the owning client getter', () => {
    const transport = createTestTransport()
    const client = transport.createClient()
    const subscription = client.onUpdate(
      query,
      {},
      () => {},
      () => {},
    )
    const error = new Error('query denied')
    transport.configureQuery(transport.queryRecord(exactQueryMatcher('notes:list', {})), {
      state: 'rejected',
      error,
    })
    expect(() => subscription.getCurrentValue()).toThrow(error)
    const shared = client.onUpdate(
      query,
      {},
      () => {},
      () => {},
    )
    expect(() => shared.getCurrentValue()).toThrow(error)
    void client.close()
  })
})
