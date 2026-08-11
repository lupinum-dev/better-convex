import { describe, expect, it } from 'vitest'

import {
  maintainedAuthConsumerRoots,
  scanAuthLogicalIdSource,
} from '../../scripts/check-auth-logical-ids.mjs'
import { getMaintainedCandidateProfile } from '../../scripts/maintained-candidate-apps.mjs'

const { profile: maintainedCandidateProfile } = getMaintainedCandidateProfile('nuxt')

function messages(source: string): string[] {
  return scanAuthLogicalIdSource(source).map((violation) => violation.message)
}

describe('auth logical-ID AST gate', () => {
  it('covers every maintained candidate application from the canonical matrix', () => {
    const coveredRoots = new Set(maintainedAuthConsumerRoots)

    for (const { path } of maintainedCandidateProfile.pnpmApps) {
      expect(coveredRoots.has(`${path}/convex`), `${path} is missing from the gate`).toBe(true)
    }
  })

  it('rejects auth-row storage IDs, projection use, and compatibility fallbacks', () => {
    expect(
      messages(`
        interface BetterAuthUserProjectionSource { _id: string; id: string }
        function project(user: BetterAuthUserProjectionSource) {
          const authId = user.id ?? user._id
          return { authId: user._id, value: authId }
        }
      `),
    ).toEqual(
      expect.arrayContaining([
        'BetterAuthUserProjectionSource exposes Convex _id',
        'Better Auth row user uses Convex _id',
        'logical id falls back to Convex _id',
        'auth projection is populated from Convex _id',
      ]),
    )
  })

  it('tracks adapter outputs and trigger payloads as auth rows', () => {
    expect(
      messages(`
        const row = await ctx.runQuery(components.betterAuth.adapter.findOne, args)
        const options = { triggers: { user: { onCreate: async (ctx, user) => user._id } } }
        console.log(row._id, options)
      `),
    ).toEqual(
      expect.arrayContaining([
        'Better Auth row row uses Convex _id',
        'Better Auth row user uses Convex _id',
      ]),
    )
  })

  it('rejects Better Auth API orchestration from a Convex query handler', () => {
    expect(
      messages(`
        export const current = query({
          handler: async (ctx) => authComponent.getAuth(createAuth, ctx),
        })
      `),
    ).toEqual(['query handler calls authComponent.getAuth()'])
  })

  it('allows application document IDs and logical Better Auth IDs', () => {
    expect(
      messages(`
        interface BetterAuthUserProjectionSource { id: string; email?: string }
        function project(user: BetterAuthUserProjectionSource, applicationUser: { _id: string }) {
          return { authId: user.id, applicationId: applicationUser._id }
        }
      `),
    ).toEqual([])
  })
})
