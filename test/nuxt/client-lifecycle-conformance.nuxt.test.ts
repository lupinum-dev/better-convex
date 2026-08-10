import type { PaginationResult } from 'convex/server'
import { describe, expect, it } from 'vitest'

import { useState } from '#imports'

import { toAuthenticatedIdentity, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
import { useConvexAction } from '../../src/runtime/composables/useConvexAction'
import { useConvexMutation } from '../../src/runtime/composables/useConvexMutation'
import { createConvexPaginatedQueryState } from '../../src/runtime/composables/useConvexPaginatedQuery'
import { createConvexQueryState } from '../../src/runtime/composables/useConvexQuery'
import { EXPECTED_CLIENT_LIFECYCLE_REPORT } from '../helpers/client-lifecycle-conformance'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt, installIdentityPortHarness } from '../helpers/nuxt-runtime-harness'
import { waitFor } from '../helpers/wait-for'

function page(ids: string[], continueCursor: string, isDone = false): PaginationResult<string> {
  return { page: ids, continueCursor, isDone }
}

describe('Nuxt shared client lifecycle conformance', () => {
  it('matches the same query, pagination, callable, identity, and disposal report as Vite', async () => {
    const client = new MockConvexClient()
    const query = mockFnRef<'query'>('conformance:query')
    const paginated = mockFnRef<'query'>('conformance:paginated')
    const mutationRef = mockFnRef<'mutation'>('conformance:mutation')
    const actionRef = mockFnRef<'action'>('conformance:action')
    client.setMutationHandler(
      'conformance:mutation',
      (args) => `mutation:user:alice:${String((args as { value: unknown }).value)}`,
    )
    client.setActionHandler(
      'conformance:action',
      (args) => `action:user:alice:${String((args as { value: unknown }).value)}`,
    )

    const { result, flush, wrapper } = await captureInNuxt(
      () => {
        const identity = useState<AuthIdentity>('convex:identity')
        useState<boolean>('convex:pending').value = false
        identity.value = toAuthenticatedIdentity('jwt-a', { id: 'alice' })
        const identityHarness = installIdentityPortHarness()
        return {
          identity,
          identityHarness,
          query: createConvexQueryState(query, {}).resultData,
          pagination: createConvexPaginatedQueryState(paginated, {}, { initialNumItems: 1 }, true)
            .resultData,
          mutation: useConvexMutation(mutationRef),
          action: useConvexAction(actionRef),
        }
      },
      { owner: makeMockOwner(client) },
    )
    await flush()
    await waitFor(() => client.activeListenerCountWhere((entry) => entry.query === query) === 1)
    await waitFor(() => client.activeListenerCountWhere((entry) => entry.query === paginated) === 1)

    client.emitQueryResultByPath('conformance:query', ['query-a'])
    client.emitQueryResultWhere(
      (entry) =>
        entry.query === paginated &&
        (entry.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor ===
          null,
      page(['page-a'], 'cursor-1'),
    )
    result.pagination.loadMore(1)
    await waitFor(() => client.activeListenerCountWhere((entry) => entry.query === paginated) === 2)
    client.emitQueryResultWhere(
      (entry) =>
        entry.query === paginated &&
        (entry.args as { paginationOpts: { cursor: string | null } }).paginationOpts.cursor ===
          'cursor-1',
      page(['page-b'], '', true),
    )
    await flush()

    const beforeIdentityChange = {
      query: result.query.data.value ?? [],
      pagination: result.pagination.data.value ?? [],
      mutation: await result.mutation({ value: 'write' } as never),
      action: await result.action({ value: 'work' } as never),
    }

    const retiredQuery = client.queuedQueryResultByPath('conformance:query', ['late'])
    result.identity.value = toAuthenticatedIdentity('jwt-b', { id: 'bob' })
    result.identityHarness.advance()
    await flush()
    const afterIdentityChange = {
      query: result.query.data.value,
      pagination: result.pagination.data.value,
      mutationStatus: result.mutation.status.value,
      actionStatus: result.action.status.value,
    }

    wrapper.unmount()
    retiredQuery()
    const report = {
      beforeIdentityChange,
      afterIdentityChange,
      afterDispose: {
        query: result.query.data.value,
        activeQuerySubscriptions: client.activeListenerCountWhere((entry) => entry.query === query),
        activePaginationSubscriptions: client.activeListenerCountWhere(
          (entry) => entry.query === paginated,
        ),
        identityListeners: result.identityHarness.listenerCount(),
      },
    }

    expect(report).toEqual({
      ...EXPECTED_CLIENT_LIFECYCLE_REPORT,
      afterDispose: {
        ...EXPECTED_CLIENT_LIFECYCLE_REPORT.afterDispose,
        // The app-owned identity projection outlives an individual component.
        identityListeners: 1,
      },
    })
  })
})
