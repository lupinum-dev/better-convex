import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { initConvexTest } from './test.setup'

async function seedAgency(t: ReturnType<typeof initConvexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      subject: 'agency-owner',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const agencyOrganizationId = await ctx.db.insert('organizations', {
      name: 'Agency',
      kind: 'agency',
      createdBy: userId,
      createdAt: Date.now(),
    })
    await ctx.db.insert('memberships', {
      organizationId: agencyOrganizationId,
      userId,
      role: 'owner',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return { agencyOrganizationId, userId }
  })
}

describe('agency resource bounds', () => {
  it('queries active links before applying the client list limit', async () => {
    const t = initConvexTest()
    const { agencyOrganizationId, userId } = await seedAgency(t)
    await t.run(async (ctx) => {
      for (let index = 0; index < 105; index += 1) {
        const clientOrganizationId = await ctx.db.insert('organizations', {
          name: `Revoked ${index}`,
          kind: 'client',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await ctx.db.insert('organizationLinks', {
          agencyOrganizationId,
          clientOrganizationId,
          status: 'revoked',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
      }
      const activeClientId = await ctx.db.insert('organizations', {
        name: 'Active',
        kind: 'client',
        createdBy: userId,
        createdAt: 0,
      })
      await ctx.db.insert('organizationLinks', {
        agencyOrganizationId,
        clientOrganizationId: activeClientId,
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
      })
    })

    expect(
      await (
        await signInAs(t, 'agency-owner')
      ).query(api.organizationLinks.listClients, {
        agencyOrganizationId,
      }),
    ).toEqual([expect.objectContaining({ name: 'Active', kind: 'client' })])
  })
})
