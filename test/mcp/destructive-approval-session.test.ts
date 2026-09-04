/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { componentsGeneric, makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'

import type { ComponentApi } from '../../src/runtime/convex-auth/component/_generated/component'
import authSchema from '../../src/runtime/convex-auth/component/schema'
import schema from '../../starters/mcp-oauth-agent/convex/schema'

const rootModules = import.meta.glob('../../starters/mcp-oauth-agent/convex/**/*.ts')
const authModules = import.meta.glob('../../src/runtime/convex-auth/component/**/*.ts')
const components = componentsGeneric() as unknown as { betterAuth: ComponentApi<'betterAuth'> }
const approveProjectDelete = makeFunctionReference<'mutation', { approvalId: string }, string>(
  'approvals:approveProjectDelete',
)

const now = Date.now()
const authUser = {
  id: 'admin-auth-id',
  name: 'Admin',
  email: 'admin@example.test',
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
}
const authSession = {
  id: 'admin-session-id',
  userId: authUser.id,
  token: 'admin-session-token',
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 60_000,
  ipAddress: null,
  userAgent: null,
}
const identity = {
  subject: authUser.id,
  sid: authSession.id,
  token_use: 'convex-session',
}

async function setup() {
  const test = convexTest(schema, rootModules)
  test.registerComponent('betterAuth', authSchema, authModules)
  await test.mutation(components.betterAuth.adapter.create, { model: 'user', data: authUser })
  await test.mutation(components.betterAuth.adapter.create, { model: 'session', data: authSession })
  const ids = await test.run(async (ctx) => {
    const adminId = await ctx.db.insert('users', {
      authId: authUser.id,
      email: authUser.email,
      name: authUser.name,
      active: true,
      oauthAdmin: false,
    })
    const requesterId = await ctx.db.insert('users', {
      authId: 'requester-auth-id',
      email: 'requester@example.test',
      name: 'Requester',
      active: true,
      oauthAdmin: false,
    })
    const organizationId = await ctx.db.insert('organizations', { name: 'Test' })
    await ctx.db.insert('memberships', {
      organizationId,
      userId: adminId,
      role: 'admin',
      status: 'active',
    })
    const projectId = await ctx.db.insert('projects', {
      organizationId,
      name: 'Protected project',
      status: 'active',
      createdBy: requesterId,
    })
    const approvalId = await ctx.db.insert('approvals', {
      operation: 'projects.delete',
      projectId,
      organizationId,
      userId: requesterId,
      clientId: 'requester-client',
      status: 'pending',
      expiresAt: now + 60_000,
    })
    return { adminId, approvalId }
  })
  return { test, ...ids }
}

describe('destructive project approval', () => {
  it('accepts an active administrator with a live canonical session', async () => {
    const { test, adminId, approvalId } = await setup()

    await expect(
      test.withIdentity(identity).mutation(approveProjectDelete, { approvalId }),
    ).resolves.toBe(approvalId)
    await expect(test.run((ctx) => ctx.db.get(approvalId))).resolves.toMatchObject({
      approvedBy: adminId,
      status: 'approved',
    })
  })

  it('rejects the same JWT after its canonical session is revoked', async () => {
    const { test, approvalId } = await setup()
    await test.mutation(components.betterAuth.adapter.deleteOne, {
      model: 'session',
      where: [{ field: 'id', value: authSession.id }],
    })

    await expect(
      test.withIdentity(identity).mutation(approveProjectDelete, { approvalId }),
    ).rejects.toMatchObject({ data: 'Unauthenticated' })
    await expect(test.run((ctx) => ctx.db.get(approvalId))).resolves.toMatchObject({
      status: 'pending',
    })
  })
})
