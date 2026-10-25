import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'

/**
 * Identity guards that close account-takeover paths Better Auth leaves open
 * by default. The factory owns this plugin; options cannot turn it off.
 */
export function createIdentityGuardsPlugin(trustedProviders: readonly string[]): BetterAuthPlugin {
  const trusted = new Set(trustedProviders)
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
        {
          // Linking a trusted provider skips Better Auth's check that the provider
          // verified the email. That trust is safe only for a user who already proved
          // the address: a squatter who registered someone else's address with a
          // password could otherwise link a provider account whose email claim they
          // chose, and keep signing in through it after the owner verifies.
          matcher: (context) => context.path === '/link-social',
          handler: createAuthMiddleware(async (context) => {
            const provider = (context.body as { provider?: unknown } | undefined)?.provider
            if (typeof provider !== 'string' || !trusted.has(provider)) return
            const user = (await getSessionFromCtx(context))?.user as
              | { emailVerified?: unknown; isAnonymous?: unknown }
              | undefined
            // Without a session the route itself answers 401.
            if (!user || user.emailVerified === true || user.isAnonymous === true) return
            throw new APIError('FORBIDDEN', {
              message: 'AUTH_LINK_UNVERIFIED_EMAIL',
              code: 'AUTH_LINK_UNVERIFIED_EMAIL',
            })
          }),
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
 *
 * The hook sees the new values, not the stored row, so verifying an address
 * that is already verified also ends sessions. That errs toward signing out;
 * reading the row first would need a wrapper around the auth adapter.
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
        // Take the mark first, so it cannot outlive this update.
        const marked = context ? verifying.delete(context) : false
        if (!user || !context || !marked) return
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
