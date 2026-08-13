import {
  convexAuth,
  createAuthComponent,
  getConvexAuthProvider,
  requireAuthOrigin,
  type AuthCtx,
  type AuthFunctions,
  type BetterAuthUserProjectionSource,
} from '@lupinum/better-convex-nuxt/convex-auth'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { ConvexError, v } from 'convex/values'

import { components, internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import { internalMutation, type MutationCtx } from './_generated/server'

type AgencyUserDoc = {
  _id: Id<'users'>
  subject: string
  name?: string
  email?: string
  createdAt: number
  updatedAt: number
}

type BetterAuthUserPage = {
  page: BetterAuthUserProjectionSource[]
  continueCursor: string
  isDone: boolean
}

const authFunctions: AuthFunctions = internal.auth

function assertAuthSecretsConfigured(): void {
  if (!process.env.BETTER_AUTH_SECRETS) throw new Error('BETTER_AUTH_SECRETS is required')
}

const duplicateActorMessage =
  'Duplicate Agency user actors require explicit reference reconciliation'

function userProjectionPatch(
  user: BetterAuthUserProjectionSource,
  existing: AgencyUserDoc,
  now: number,
) {
  const name = user.name ?? undefined
  const email = user.email ?? undefined
  if (name === existing.name && email === existing.email) return null

  return { name, email, updatedAt: now }
}

async function syncAgencyUserActor(
  ctx: MutationCtx,
  user: BetterAuthUserProjectionSource,
  insertIfMissing: boolean,
): Promise<'inserted' | 'patched' | 'skipped'> {
  const actors = await ctx.db
    .query('users')
    .withIndex('by_subject', (q) => q.eq('subject', user.id))
    .take(2)
  if (actors.length > 1) {
    // These rows are stable domain actors referenced throughout the Agency
    // schema, not disposable projections. Choosing and deleting one here could
    // leave organizations, memberships, projects, or audit events dangling.
    throw new ConvexError(duplicateActorMessage)
  }

  const actor = actors[0]
  const now = Date.now()
  if (!actor) {
    if (!insertIfMissing) return 'skipped'

    await ctx.db.insert('users', {
      subject: user.id,
      name: user.name ?? undefined,
      email: user.email ?? undefined,
      createdAt: now,
      updatedAt: now,
    })
    return 'inserted'
  }

  const patch = userProjectionPatch(user, actor, now)
  if (!patch) return 'skipped'

  await ctx.db.patch(actor._id, patch)
  return 'patched'
}

export const authComponent = createAuthComponent<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, user) => {
        await syncAgencyUserActor(ctx, user as BetterAuthUserProjectionSource, true)
      },
      onUpdate: async (ctx, user) => {
        await syncAgencyUserActor(ctx, user as BetterAuthUserProjectionSource, false)
      },
      onDelete: async (ctx, user) => {
        // Keep the stable actor and its references, but remove the display PII
        // copied from the deleted Better Auth user.
        await syncAgencyUserActor(ctx, { id: String(user.id) }, false)
      },
    },
  },
})

export const { onCreate, onUpdate, onDelete } = authComponent.triggerFunctions()

/** Rebuild one bounded page of the app user projection from Better Auth user truth. */
export const rebuildUserProjectionBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const users = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: args.cursor, numItems: 100 },
    })) as BetterAuthUserPage
    const result = { inserted: 0, patched: 0, skipped: 0 }
    for (const user of users.page) {
      const outcome = await syncAgencyUserActor(ctx, user, true)
      result[outcome] += 1
    }

    return {
      ...result,
      continueCursor: users.continueCursor,
      isDone: users.isDone,
    }
  },
})

// Pre-traffic operator ceremony: provision/rotate the one official JWT key graph.
export const { rotateSigningKey } = authComponent.jwksOperatorFunctions(createAuth)

export async function createAuth(ctx: AuthCtx<DataModel>) {
  try {
    const siteUrl = requireAuthOrigin('SITE_URL')
    const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
    const authIssuer = `${siteUrl}/api/auth`
    assertAuthSecretsConfigured()
    const auth = betterAuth({
      account: { encryptOAuthTokens: true, storeAccountCookie: false },
      advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
      basePath: '/api/auth',
      baseURL: siteUrl,
      database: authComponent.adapter(ctx),
      disabledPaths: [
        '/token',
        '/get-access-token',
        '/refresh-token',
        '/.well-known/openid-configuration',
        '/oauth2/register',
        '/oauth2/introspect',
        '/oauth2/userinfo',
        '/oauth2/end-session',
      ],
      emailAndPassword: { autoSignIn: false, enabled: true, minPasswordLength: 15 },
      plugins: [
        jwt({
          disableSettingJwtHeader: true,
          jwks: {
            disablePrivateKeyEncryption: false,
            gracePeriod: 21 * 60,
            keyPairConfig: { alg: 'RS256' },
          },
          jwt: { audience: authIssuer, expirationTime: '10m', issuer: authIssuer },
        }),
        convexAuth({
          authConfig: { providers: [getConvexAuthProvider()] },
          sessionJwt: { audience: 'convex', expirationTime: '15m', issuer: convexSiteUrl },
        }),
      ],
      rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
      trustedOrigins: [siteUrl],
      verification: { storeIdentifier: 'hashed' },
    })
    await auth.$context
    return auth
  } catch {
    throw new Error('AUTH_CONFIG_INVALID')
  }
}
