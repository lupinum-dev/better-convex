import { afterEach, describe, expect, it, vi } from 'vitest'

import { useState } from '#imports'

import {
  ANONYMOUS_IDENTITY,
  LOADING_IDENTITY,
  toAuthenticatedIdentity,
  type AuthIdentity,
} from '../../src/runtime/auth/auth-identity'
import { createConvexQueryState } from '../../src/runtime/composables/useConvexQuery'
import { makeMockOwner } from '../helpers/mock-client-owner'
import { MockConvexClient, mockFnRef } from '../helpers/mock-convex-client'
import { captureInNuxt } from '../helpers/nuxt-runtime-harness'

afterEach(() => {
  vi.clearAllMocks()
})

/**
 * "Auth execution-count matrix": spy on WebSocket subscription
 * acquisition (`MockConvexClient.calls.onUpdate`, one entry per acquired live
 * listener) across the browser-side contexts of the 7×3 table, every cell
 * asserted with counts (architecture invariant "count effects, not only visible
 * outcomes"). Counts are asserted as deltas across the observed transition
 * rather than hardcoded absolutes, because the composable's own mount-time
 * reactivity (auth-context + identity computed settling) may contribute a
 * fixed baseline of acquisitions before the transition under test; the delta
 * IS the number the table specifies.
 *
 * SSR / hydration rows are exercised qualitatively by the dedicated SSR tests
 * in `test/nuxt/useConvexQuery.nuxt.test.ts` (blocking-first-value / `server:
 * false`) and the auth-disabled fixture's build-graph scan; they are not
 * re-implemented here because they require the HTTP `executeQueryHttp` path,
 * not the live-subscription path this file spies on.
 */
describe('auth execution-count matrix — browser contexts ', () => {
  it('client navigation while loading: none acquires immediately; optional executes once on settlement; required stays idle', async () => {
    // none: no wait, immediate anonymous acquisition.
    {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>('matrix:nav:none')
      const { flush } = await captureInNuxt(
        () => {
          const pending = useState<boolean>('convex:pending', () => true)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = true
          identity.value = LOADING_IDENTITY
          return createConvexQueryState(query, {}, { auth: 'none' }).resultData
        },
        { owner: makeMockOwner(primary) },
      )
      await flush()
      expect(primary.calls.onUpdate.length).toBeGreaterThan(0)
    }

    // optional/required: zero acquisitions while loading, then a delta once
    // settlement happens (optional -> anonymous execution; required -> idle).
    for (const mode of ['optional', 'required'] as const) {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>(`matrix:nav:${mode}`)
      const { result, flush } = await captureInNuxt(
        () => {
          const pending = useState<boolean>('convex:pending', () => true)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = true
          identity.value = LOADING_IDENTITY
          return createConvexQueryState(query, {}, { auth: mode }).resultData
        },
        { owner: makeMockOwner(primary) },
      )
      await flush()
      expect(primary.calls.onUpdate.length).toBe(0) // waits while loading

      const pending = useState<boolean>('convex:pending')
      const identity = useState<AuthIdentity>('convex:identity')
      identity.value = ANONYMOUS_IDENTITY
      pending.value = false // settles anonymous
      await flush()

      if (mode === 'optional') {
        expect(primary.calls.onUpdate.length).toBe(1)
      } else {
        expect(primary.calls.onUpdate.length).toBe(0) // required: stays idle
        expect(result.status.value).toBe('idle')
      }
    }
  })

  it('sign-in: none has zero auth-driven reruns; optional/required each acquire exactly one delta for the user', async () => {
    for (const mode of ['none', 'optional', 'required'] as const) {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>(`matrix:signin:${mode}`)

      const { flush } = await captureInNuxt(
        () => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = ANONYMOUS_IDENTITY
          return createConvexQueryState(query, {}, { auth: mode }).resultData
        },
        { owner: makeMockOwner(primary) },
      )
      await flush()
      const before = primary.calls.onUpdate.length

      const identity = useState<AuthIdentity>('convex:identity')
      identity.value = toAuthenticatedIdentity('jwt-u1', { id: 'u1' })
      await flush()
      const delta = primary.calls.onUpdate.length - before

      if (mode === 'none') {
        expect(delta).toBe(0) // zero auth-driven reruns
      } else {
        expect(delta).toBe(1)
      }
    }
  })

  it('sign-out: none has zero auth-driven reruns; optional reruns once anonymously; required releases to idle with zero new calls', async () => {
    for (const mode of ['none', 'optional', 'required'] as const) {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>(`matrix:signout:${mode}`)

      const { result, flush } = await captureInNuxt(
        () => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = toAuthenticatedIdentity('jwt-u1', { id: 'u1' })
          return createConvexQueryState(query, {}, { auth: mode }).resultData
        },
        { owner: makeMockOwner(primary) },
      )
      await flush()
      const before = primary.calls.onUpdate.length

      const identity = useState<AuthIdentity>('convex:identity')
      identity.value = ANONYMOUS_IDENTITY
      await flush()
      const delta = primary.calls.onUpdate.length - before

      if (mode === 'none') {
        expect(delta).toBe(0)
      } else if (mode === 'optional') {
        expect(delta).toBe(1)
      } else {
        expect(delta).toBe(0) // zero new calls; release to idle
        expect(primary.activeListenerCount(query, {})).toBe(0)
        expect(result.status.value).toBe('idle')
      }
    }
  })

  it('same-user token rotation: zero acquisitions/releases for every mode', async () => {
    for (const mode of ['none', 'optional', 'required'] as const) {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>(`matrix:rotation:${mode}`)

      const { flush } = await captureInNuxt(
        () => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = toAuthenticatedIdentity('jwt-u1-1', { id: 'u1' })
          return createConvexQueryState(query, {}, { auth: mode }).resultData
        },
        { owner: makeMockOwner(primary) },
      )
      await flush()
      const before = primary.calls.onUpdate.length

      // Same-user token rotation does not change the identity KEY (same
      // `user.id`); the isolation dimension the composable keys off never
      // changes, so publishing a rotated token for the same user must not reacquire.
      const identity = useState<AuthIdentity>('convex:identity')
      identity.value = toAuthenticatedIdentity('jwt-u1-2', { id: 'u1' })
      await flush()

      expect(primary.calls.onUpdate.length).toBe(before)
    }
  })

  it('user A to user B: zero for none; optional/required each acquire exactly one delta per authenticated identity transition', async () => {
    for (const mode of ['none', 'optional', 'required'] as const) {
      const primary = new MockConvexClient()
      const query = mockFnRef<'query'>(`matrix:AtoB:${mode}`)

      const { flush } = await captureInNuxt(
        () => {
          const pending = useState<boolean>('convex:pending', () => false)
          const identity = useState<AuthIdentity>('convex:identity')
          pending.value = false
          identity.value = toAuthenticatedIdentity('jwt-A', { id: 'A' })
          return createConvexQueryState(query, {}, { auth: mode }).resultData
        },
        { owner: makeMockOwner(primary) },
      )
      await flush()
      const before = primary.calls.onUpdate.length

      const identity = useState<AuthIdentity>('convex:identity')
      identity.value = toAuthenticatedIdentity('jwt-B', { id: 'B' })
      await flush()
      const delta = primary.calls.onUpdate.length - before

      if (mode === 'none') {
        expect(delta).toBe(0) // identity-blind transport
      } else {
        expect(delta).toBe(1)
      }
    }
  })
})
