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

/**
 * Proving an address ends every session that existed before the proof. A
 * squatter who registered the address with a password and signed in holds such
 * a session; the owner's later verification must not leave it alive. A session
 * that the verification itself creates (auto sign-in) is made after the update,
 * so it survives. The password stays: it may belong to the honest owner.
 */
export function createRevokeSessionsOnVerificationHooks(): Pick<UserHooks, 'update'> {
  // One verifying update per request: `before` marks the request, `after` revokes.
  const verifying = new WeakSet<object>()
  return {
    update: {
      before: async (data, context) => {
        if (context && (data as { emailVerified?: unknown }).emailVerified === true) {
          verifying.add(context)
        }
      },
      after: async (user, context) => {
        if (!user || !context || !verifying.delete(context)) return
        await context.context.internalAdapter.deleteUserSessions(user.id)
      },
    },
  }
}

/**
 * A user may start with an unverified email only through password sign-up
 * (`/sign-up/email`, which then needs verification before sign-in) or as an
 * anonymous guest. Any other path that carries an unverified address, such as
 * a social provider that lets an account holder choose its email claim, would
 * hand a session to someone who never proved the address.
 */
export function assertVerifiedUnlessPasswordSignUp(
  user: { emailVerified?: unknown; isAnonymous?: unknown },
  context: { path?: string } | null,
): void {
  if (!context || user.emailVerified === true || user.isAnonymous === true) return
  if (context.path === '/sign-up/email') return
  throw new APIError('FORBIDDEN', { message: 'AUTH_USER_CREATE_UNVERIFIED_EMAIL' })
}
