import type { GenericEndpointContext } from '@better-auth/core'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'

/**
 * Identity guards that close account-takeover paths Better Auth leaves open
 * by default. The factory owns this plugin; options cannot turn it off.
 */
export function createIdentityGuardsPlugin(): BetterAuthPlugin {
  return {
    id: 'better-convex-identity-guards',
    hooks: {
      before: [
        {
          // A changed password must end every other session of that person.
          matcher: (context) => context.path === '/change-password',
          handler: createAuthMiddleware(async (context) => ({
            context: {
              ...context,
              body: { ...(context.body as object), revokeOtherSessions: true },
            },
          })),
        },
      ],
    },
  }
}

type UserHooks = NonNullable<NonNullable<BetterAuthOptions['databaseHooks']>['user']>

type UserRecord = { id: string; emailVerified?: boolean | null }
type AdapterCall = { model: string; where: unknown; update?: Record<string, unknown> }
type UserAdapter = {
  findOne: (call: AdapterCall) => Promise<UserRecord | null>
  update: (call: AdapterCall) => Promise<UserRecord | null>
}

/**
 * Proving an address ends every session that existed before the proof. A
 * squatter who registered the address with a password and signed in holds such
 * a session; the owner's later verification must not leave it alive. A session
 * that the verification itself creates (auto sign-in) is made after the update,
 * so it survives. The password stays: it may belong to the honest owner.
 *
 * Only a change from unverified to verified counts. Better Auth's hook gets
 * the new values but not the stored row, so `wrapDatabase` reads the row before
 * a user update that sets `emailVerified: true` and records the users it moves
 * across that line. A repeated verification (or a provider that re-sends
 * `emailVerified: true`) therefore ends no session.
 */
export function createRevokeSessionsOnVerification() {
  const proven = new Set<string>()
  return {
    hooks: {
      update: {
        after: async (user: UserRecord | null, context: GenericEndpointContext | null) => {
          // Take the mark first, so it cannot outlive this update.
          const moved = user ? proven.delete(user.id) : false
          if (!user || !moved || !context) return
          await context.context.internalAdapter.deleteUserSessions(user.id)
        },
      },
    } satisfies Pick<UserHooks, 'update'>,
    wrapDatabase<Options, Adapter extends object>(
      factory: (options: Options) => Adapter,
    ): (options: Options) => Adapter {
      return (options) => {
        const adapter = factory(options)
        const users = adapter as unknown as UserAdapter
        return {
          ...adapter,
          update: async (call: AdapterCall) => {
            if (call.model !== 'user' || call.update?.emailVerified !== true) {
              return await users.update(call)
            }
            const before = await users.findOne({ model: 'user', where: call.where })
            const updated = await users.update(call)
            if (before && before.emailVerified !== true && updated) proven.add(updated.id)
            return updated
          },
        } as Adapter
      }
    },
  }
}

/**
 * A user may start with an unverified email only through password sign-up
 * (`/sign-up/email`, which then needs verification before sign-in) or as an
 * anonymous guest. Any other path that carries an unverified address, such as
 * a social provider that lets an account holder choose its email claim, would
 * hand a session to someone who never proved the address. Without an endpoint
 * context the path is unknown, so only a verified address passes.
 */
export function assertVerifiedUnlessPasswordSignUp(
  user: { emailVerified?: unknown; isAnonymous?: unknown },
  context: { path?: string } | null,
): void {
  if (user.emailVerified === true || user.isAnonymous === true) return
  if (context?.path === '/sign-up/email') return
  throw new APIError('FORBIDDEN', {
    message: 'AUTH_USER_CREATE_UNVERIFIED_EMAIL',
    code: 'AUTH_USER_CREATE_UNVERIFIED_EMAIL',
  })
}
