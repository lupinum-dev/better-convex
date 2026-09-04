/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, getFunctionAddress, type UserIdentity } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import { createAuthComponent } from '../../src/runtime/convex-auth/create-auth-component'
import schema from '../fixtures/workforce-component/convex/betterAuth/schema'

const modules = import.meta.glob('../fixtures/workforce-component/convex/betterAuth/**/*.ts')
const components = componentsGeneric() as unknown as {
  workforceAuth: ComponentApi<'workforceAuth'>
}
const component = components.workforceAuth
const sessions = createAuthComponent(component).workforceSessions
const identity = {
  subject: 'verified-user',
  sid: 'verified-session',
  token_use: 'convex-session',
} satisfies Partial<UserIdentity>
const actor = { userId: identity.subject, sessionId: identity.sid }
const paginationOpts = { cursor: 'opaque-cursor', numItems: 12 }

describe('workforce session component client', () => {
  it('dispatches exact management references and derives the actor from verified identity', async () => {
    const test = convexTest(schema, modules).withIdentity(identity)
    await test.run(async (ctx) => {
      const runMutation = vi.spyOn(ctx, 'runMutation').mockResolvedValue(null)
      const runQuery = vi.spyOn(ctx, 'runQuery').mockResolvedValue(null)
      const getIdentity = vi.spyOn(ctx.auth, 'getUserIdentity')

      await sessions.touch(ctx)
      await sessions.list(ctx, paginationOpts)
      await sessions.revoke(ctx, 'another-session')
      await sessions.revokeAll(ctx)

      expect(getIdentity).toHaveBeenCalledTimes(4)
      expect(
        runMutation.mock.calls.map(([reference, args]) => [getFunctionAddress(reference), args]),
      ).toEqual([
        [getFunctionAddress(component.adapter.touchWorkforceSession), { actor }],
        [
          getFunctionAddress(component.adapter.revokeWorkforceSession),
          { actor, sessionId: 'another-session' },
        ],
        [getFunctionAddress(component.adapter.revokeAllWorkforceSessions), { actor }],
      ])
      expect(
        runQuery.mock.calls.map(([reference, args]) => [getFunctionAddress(reference), args]),
      ).toEqual([
        [getFunctionAddress(component.adapter.listWorkforceSessions), { actor, paginationOpts }],
      ])
    })
  })

  it('treats the supplied revocation target only as a target, not as actor authority', async () => {
    const test = convexTest(schema, modules).withIdentity(identity)
    await test.run(async (ctx) => {
      const runMutation = vi.spyOn(ctx, 'runMutation').mockResolvedValue(null)
      await sessions.revoke(ctx, 'foreign-owner-session')
      expect(runMutation.mock.calls[0]?.[1]).toEqual({
        actor,
        sessionId: 'foreign-owner-session',
      })
      // Target ownership is checked by the canonical mutation, not guessed here.
      expect(runMutation).toHaveBeenCalledTimes(1)
    })
  })

  it('returns canonical results without synthesizing management state', async () => {
    const test = convexTest(schema, modules).withIdentity(identity)
    await test.run(async (ctx) => {
      const touched = { expiresAt: 1_700_003_600_000 }
      const page = { page: [], continueCursor: 'next', isDone: false }
      const runMutation = vi.spyOn(ctx, 'runMutation').mockResolvedValue(touched)
      vi.spyOn(ctx, 'runQuery').mockResolvedValue(page)
      expect(await sessions.touch(ctx)).toBe(touched)
      expect(await sessions.list(ctx, paginationOpts)).toBe(page)
      runMutation.mockResolvedValue(null)
      expect(await sessions.revoke(ctx, 'target')).toBeNull()
      expect(await sessions.revokeAll(ctx)).toBeNull()
    })
  })

  it.each([
    { label: 'no identity', claims: null },
    { label: 'missing sid', claims: { subject: 'user', token_use: 'convex-session' } },
    { label: 'empty sid', claims: { ...identity, sid: '' } },
    { label: 'non-string sid', claims: { ...identity, sid: 17 } },
    { label: 'missing token class', claims: { subject: 'user', sid: 'session' } },
    { label: 'OAuth token', claims: { ...identity, token_use: 'oauth-access' } },
    { label: 'wrong token class', claims: { ...identity, token_use: 'session' } },
  ] satisfies Array<{ label: string; claims: Partial<UserIdentity> | null }>)(
    'rejects $label before any component dispatch',
    async ({ claims }) => {
      const base = convexTest(schema, modules)
      const test = claims ? base.withIdentity(claims) : base
      await test.run(async (ctx) => {
        const runMutation = vi.spyOn(ctx, 'runMutation').mockResolvedValue(null)
        const runQuery = vi.spyOn(ctx, 'runQuery').mockResolvedValue(null)
        await expect(sessions.touch(ctx)).rejects.toThrow('Unauthenticated')
        await expect(sessions.list(ctx, paginationOpts)).rejects.toThrow('Unauthenticated')
        await expect(sessions.revoke(ctx, 'target')).rejects.toThrow('Unauthenticated')
        await expect(sessions.revokeAll(ctx)).rejects.toThrow('Unauthenticated')
        expect(runMutation).not.toHaveBeenCalled()
        expect(runQuery).not.toHaveBeenCalled()
      })
    },
  )

  it('propagates canonical denial instead of reporting successful management', async () => {
    const test = convexTest(schema, modules).withIdentity(identity)
    await test.run(async (ctx) => {
      const denied = new Error('AUTH_WORKFORCE_SESSION_REQUIRED')
      vi.spyOn(ctx, 'runMutation').mockRejectedValue(denied)
      vi.spyOn(ctx, 'runQuery').mockRejectedValue(denied)
      await expect(sessions.touch(ctx)).rejects.toBe(denied)
      await expect(sessions.list(ctx, paginationOpts)).rejects.toBe(denied)
      await expect(sessions.revoke(ctx, 'target')).rejects.toBe(denied)
      await expect(sessions.revokeAll(ctx)).rejects.toBe(denied)
    })
  })
})
