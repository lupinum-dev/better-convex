import { describe, expect, it } from 'vitest'

import { useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  LOADING_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { createConvexQueryState } from '../../src/runtime/composables/useConvexQuery'
import type { ConvexAuthMode } from '../../src/runtime/utils/auth-status'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

/**
 * "Auth execution-count matrix": spy on WebSocket subscription acquisition
 * (`MockConvexClient.calls.onUpdate`, one entry per acquired live listener)
 * across the browser-side auth transitions, every cell asserted with counts
 * (architecture invariant "count effects, not only visible outcomes"). The
 * delta across the transition is the number the table specifies.
 *
 * SSR / hydration rows are exercised by the dedicated SSR tests in
 * `test/nuxt/useConvexQuery.nuxt.test.ts` and the auth-disabled fixture's
 * build-graph scan; they need the HTTP `executeQueryHttp` path, not the live
 * subscription path this file spies on.
 */
type AuthState = { pending: boolean; identity: AuthIdentity }
const loading: AuthState = { pending: true, identity: LOADING_IDENTITY }
const anonymous: AuthState = { pending: false, identity: ANONYMOUS_IDENTITY }
const user = (id: string): AuthState => ({
  pending: false,
  identity: toAuthenticatedIdentity({ id }),
})

const transitions = {
  // Client navigation while auth loads, then settles anonymous.
  'loading -> anonymous': [loading, anonymous],
  'sign-in': [anonymous, user('A')],
  'sign-out': [user('A'), anonymous],
  // A rotated token for the same user does not change the identity key.
  'same-user token rotation': [user('A'), user('A')],
  'user A -> user B': [user('A'), user('B')],
} as const satisfies Record<string, readonly [AuthState, AuthState]>

describe('auth execution-count matrix — browser contexts', () => {
  it.each<{
    transition: keyof typeof transitions
    auth: ConvexAuthMode
    before?: number
    delta: number
    idle?: true
  }>([
    // none never waits for auth; optional and required acquire nothing while loading.
    { transition: 'loading -> anonymous', auth: 'none', before: 1, delta: 0 },
    { transition: 'loading -> anonymous', auth: 'optional', before: 0, delta: 1 },
    { transition: 'loading -> anonymous', auth: 'required', before: 0, delta: 0, idle: true },
    { transition: 'sign-in', auth: 'none', delta: 0 },
    { transition: 'sign-in', auth: 'optional', delta: 1 },
    { transition: 'sign-in', auth: 'required', delta: 1 },
    { transition: 'sign-out', auth: 'none', delta: 0 },
    { transition: 'sign-out', auth: 'optional', delta: 1 },
    { transition: 'sign-out', auth: 'required', delta: 0, idle: true },
    { transition: 'same-user token rotation', auth: 'none', delta: 0 },
    { transition: 'same-user token rotation', auth: 'optional', delta: 0 },
    { transition: 'same-user token rotation', auth: 'required', delta: 0 },
    { transition: 'user A -> user B', auth: 'none', delta: 0 },
    { transition: 'user A -> user B', auth: 'optional', delta: 1 },
    { transition: 'user A -> user B', auth: 'required', delta: 1 },
  ])('$transition: $auth acquires $delta', async ({ transition, auth, before, delta, idle }) => {
    const [from, to] = transitions[transition]
    const primary = new MockConvexClient()
    const query = mockFnRef<'query'>(`matrix:${transition}:${auth}`)

    const { result, flush } = await captureInNuxt(
      () => {
        const pending = useState<boolean>('convex:pending')
        const identity = useState<AuthIdentity>('convex:identity')
        pending.value = from.pending
        identity.value = from.identity
        return {
          pending,
          identity,
          query: createConvexQueryState(query, {}, { auth }).resultData,
        }
      },
      { owner: makeMockOwner(primary) },
    )
    await flush()
    const acquiredBefore = primary.calls.onUpdate.length
    if (before !== undefined) expect(acquiredBefore).toBe(before)

    result.identity.value = to.identity
    result.pending.value = to.pending
    await flush()

    expect(primary.calls.onUpdate.length - acquiredBefore).toBe(delta)
    if (idle) {
      expect(primary.activeListenerCount(query, {})).toBe(0)
      expect(result.query.status.value).toBe('idle')
      expect(result.query.blockedBy.value).toBe('auth')
    }
  })
})
