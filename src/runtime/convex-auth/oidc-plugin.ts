/**
 * The Better Auth plugin behind the `oidc` option. It adds the owned `oidc`
 * provider, guards the doors of IdP-managed users, serves the back-channel
 * logout route, and owns "this user's IdP grant is over" (`endGrant`).
 */
import type { AuthContext, GenericEndpointContext } from '@better-auth/core'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { decryptOAuthToken, setTokenUtil } from 'better-auth/oauth2'

import { logOidcFailure } from './diagnostics'
import { handleOidcBackchannelLogout, type OidcBackchannelDeps } from './oidc-backchannel-logout'
import { OidcError } from './oidc-fetch'
import { getOidcClient } from './oidc-metadata'
import {
  OIDC_BACKCHANNEL_LOGOUT_PATH,
  OIDC_PROVIDER_ID,
  type ResolvedOidcConfig,
} from './oidc-options'
import { createOidcProvider, currentSignInClaims } from './oidc-provider'
import {
  createOidcUpstream,
  type OidcAccountRecord,
  type OidcGrantState,
  type OidcUpstream,
} from './oidc-upstream'

/** The atomic rate-limit mutation; same shape as in `email-code-limit.ts`. */
type ConsumeRateLimit = (
  key: string,
  rule: { window: number; max: number },
) => Promise<{ allowed: boolean; retryAfter: number | null }>

type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>

export interface OidcRuntime {
  /** Filled in `init`; throws `AUTH_OIDC_NOT_INITIALIZED` before. */
  upstream(): OidcUpstream
  /** True for a user with an `oidc` account. */
  isIdpManaged(userId: string): Promise<boolean>
}

/** Run before the app issues a credential for `userId` (see `OidcUpstream.checkGrant`). */
export type OidcGrantCheck = (userId: string) => Promise<OidcGrantState>

// The plugin puts its grant check on the Better Auth context, so every place that issues a
// credential (the Convex token mint, the MCP token endpoint) reads the same check.
const OIDC_CONTEXT_KEY = 'betterConvexOidcGrantCheck'

/** The `oidc` grant check of this Better Auth instance, or `undefined` without `oidc`. */
export function readOidcGrantCheck(context: object): OidcGrantCheck | undefined {
  const check = (context as Record<string, unknown>)[OIDC_CONTEXT_KEY]
  return typeof check === 'function' ? (check as OidcGrantCheck) : undefined
}

const OIDC_BACKCHANNEL_RATE_LIMIT = { window: 60, max: 600 }

/** The routes that may delete an `oidc` account: deleting the user. */
const OIDC_ACCOUNT_DELETE_PATHS = new Set(['/delete-user', '/delete-user/callback'])

/** Signed-in routes that would set a password an IdP-managed user can never sign in with. */
const OIDC_PASSWORD_PATHS = new Set(['/change-password', '/set-password'])

function oidcSignInRequired(): APIError {
  return new APIError('FORBIDDEN', {
    code: 'OIDC_SIGN_IN_REQUIRED',
    message: 'OIDC_SIGN_IN_REQUIRED',
  })
}

function oidcUnlinkRefused(): APIError {
  return new APIError('FORBIDDEN', {
    code: 'OIDC_UNLINK_REFUSED',
    message: 'OIDC_UNLINK_REFUSED',
  })
}

function oidcSignInRefused(cause: unknown): APIError {
  logOidcFailure('AUTH_OIDC_SIGN_IN_HOOK_REFUSED', { cause })
  return new APIError('FORBIDDEN', {
    code: 'OIDC_SIGN_IN_REFUSED',
    message: 'OIDC_SIGN_IN_REFUSED',
  })
}

function oidcAccountConflict(): APIError {
  logOidcFailure('AUTH_OIDC_ACCOUNT_CONFLICT')
  return new APIError('FORBIDDEN', {
    code: 'OIDC_ACCOUNT_CONFLICT',
    message: 'OIDC_ACCOUNT_CONFLICT',
  })
}

/** Only the IdP's own callback may create a session for an IdP-managed user. Without a context the path is unknown. */
function isOidcCallback(context: GenericEndpointContext | null | undefined): boolean {
  return context?.path === '/callback/:id' && context.params?.id === OIDC_PROVIDER_ID
}

function relativePath(request: Request, baseURL: string): string | null {
  const basePath = new URL(baseURL).pathname.replace(/\/+$/u, '')
  const path = new URL(request.url).pathname
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : null
}

export function createOidcPlugin(input: {
  readonly config: ResolvedOidcConfig
  readonly consume: () => ConsumeRateLimit
  /** `oidc.onSignIn` with the auth HTTP action's context already bound. */
  readonly onSignIn?: (userId: string, claims: object) => Promise<void>
}): { readonly plugin: BetterAuthPlugin; readonly runtime: OidcRuntime } {
  const client = getOidcClient(input.config)
  let upstream: OidcUpstream | null = null
  let logoutDeps: OidcBackchannelDeps | null = null
  let isIdpManaged: ((userId: string) => Promise<boolean>) | null = null

  const runtime: OidcRuntime = {
    upstream() {
      if (!upstream) throw new Error('AUTH_OIDC_NOT_INITIALIZED')
      return upstream
    },
    isIdpManaged(userId) {
      if (!isIdpManaged) throw new Error('AUTH_OIDC_NOT_INITIALIZED')
      return isIdpManaged(userId)
    },
  }

  const plugin: BetterAuthPlugin = {
    id: 'better-convex-oidc',
    init(ctx: AuthContext) {
      // Better Auth replaces the internal adapter after every plugin init (F15): read it per call.
      const internalAdapter = () => ctx.internalAdapter

      const oidcAccounts = async (userId: string) =>
        (await internalAdapter().findAccounts(userId)).filter(
          (account) => account.providerId === OIDC_PROVIDER_ID,
        )
      const hasOidcAccount = async (userId: string) => (await oidcAccounts(userId)).length > 0
      isIdpManaged = hasOidcAccount

      const clearOidcTokens = async (userId: string) => {
        for (const account of await oidcAccounts(userId)) {
          await internalAdapter().updateAccount(account.id, {
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          })
        }
      }

      // The one owner of "this user's IdP grant is over": sessions first, then the tokens.
      const endGrant = async (userId: string) => {
        await internalAdapter().deleteUserSessions(userId)
        await clearOidcTokens(userId)
      }

      const open = async (sealed: string) => {
        if (!sealed.startsWith('$ba$')) throw new OidcError('AUTH_OIDC_REFRESH_FAILED', 'decrypt')
        return await decryptOAuthToken(sealed, ctx)
      }

      const seal = async (token: string) => {
        const sealed = await setTokenUtil(token, ctx)
        if (typeof sealed !== 'string') throw new OidcError('AUTH_OIDC_REFRESH_FAILED', 'seal')
        return sealed
      }

      upstream = createOidcUpstream({
        client,
        consume: (key, rule) => input.consume()(key, rule),
        findAccountForUser: async (userId): Promise<OidcAccountRecord | null | 'conflict'> => {
          const accounts = await oidcAccounts(userId)
          if (accounts.length > 1) return 'conflict'
          const account = accounts[0]
          if (!account) return null
          return {
            id: account.id,
            userId: account.userId,
            accountId: account.accountId,
            accessToken: account.accessToken ?? null,
            refreshToken: account.refreshToken ?? null,
            idToken: account.idToken ?? null,
            accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
          }
        },
        swapTokens: async (id, expectedRefreshToken, patch) =>
          (await ctx.adapter.update({
            model: 'account',
            where: [
              { field: 'id', value: id },
              { field: 'refreshToken', value: expectedRefreshToken },
            ],
            update: patch,
          })) !== null,
        endGrant,
        seal,
        open,
      })
      logoutDeps = {
        client,
        findUserIdBySubject: async (sub) =>
          (
            await internalAdapter().findAccountByKey({
              providerId: OIDC_PROVIDER_ID,
              accountId: await client.accountKey(sub),
            })
          )?.userId ?? null,
        endGrant,
        consume: input.consume(),
      }

      const runSignInHook = async (userId: string) => {
        if (!input.onSignIn) return
        const claims = await currentSignInClaims()
        // The callback verified an ID token in this request, so its claims are here.
        if (!claims) throw oidcSignInRefused(new Error('AUTH_OIDC_SIGN_IN_CLAIMS_MISSING'))
        try {
          await input.onSignIn(userId, claims)
        } catch (error) {
          throw oidcSignInRefused(error)
        }
      }

      const databaseHooks: DatabaseHooks = {
        session: {
          create: {
            before: async (session, context) => {
              if (isOidcCallback(context)) {
                await runSignInHook(session.userId)
                return
              }
              if (await hasOidcAccount(session.userId)) throw oidcSignInRequired()
            },
          },
        },
        account: {
          create: {
            before: async (account) => {
              if (account.providerId === OIDC_PROVIDER_ID && (await hasOidcAccount(account.userId)))
                throw oidcAccountConflict()
            },
            // Linking puts the user under the IdP: a session from another sign-in method ends,
            // so every session of the user comes from the IdP callback. A new user has none.
            after: async (account) => {
              if (account.providerId === OIDC_PROVIDER_ID)
                await internalAdapter().deleteUserSessions(account.userId)
            },
          },
          // Without its `oidc` row a user leaves the door guard, back-channel logout and the
          // liveness check. Only deleting the whole user may delete it: /unlink-account, Better
          // Auth's cleanup of unverified users at email-code sign-in, and a direct server call
          // (no route) may not.
          delete: {
            before: async (account, context) => {
              if (account.providerId !== OIDC_PROVIDER_ID) return
              if (!context || !OIDC_ACCOUNT_DELETE_PATHS.has(context.path))
                throw oidcUnlinkRefused()
            },
          },
        },
      }

      const checkGrant: OidcGrantCheck = (userId) => upstream!.checkGrant(userId)
      return {
        context: {
          socialProviders: [createOidcProvider(client), ...ctx.socialProviders],
          [OIDC_CONTEXT_KEY]: checkGrant,
        },
        options: { databaseHooks },
      }
    },
    hooks: {
      before: [
        {
          // Refused before anything is written: a password would be one the user can never use.
          matcher: (context) => OIDC_PASSWORD_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (context) => {
            const session = await getSessionFromCtx(context)
            if (session && (await runtime.isIdpManaged(session.user.id))) throw oidcSignInRequired()
          }),
        },
      ],
    },
    rateLimit: [
      {
        pathMatcher: (path) => path === OIDC_BACKCHANNEL_LOGOUT_PATH,
        ...OIDC_BACKCHANNEL_RATE_LIMIT,
      },
    ],
    async onRequest(request, ctx) {
      if (relativePath(request, ctx.baseURL) !== OIDC_BACKCHANNEL_LOGOUT_PATH) return
      if (!logoutDeps) throw new Error('AUTH_OIDC_NOT_INITIALIZED')
      return { response: await handleOidcBackchannelLogout(request, logoutDeps) }
    },
  }

  return { plugin, runtime }
}
