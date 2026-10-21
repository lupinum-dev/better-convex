/**
 * The Better Auth plugin behind the `oidc` option. It adds the owned `oidc`
 * provider, guards the doors of IdP-managed users, serves the back-channel
 * logout route, and owns "this user's IdP grant is over" (`endGrant`).
 */
import type { AuthContext, GenericEndpointContext } from '@better-auth/core'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { APIError } from 'better-auth/api'
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
import { createOidcProvider } from './oidc-provider'
import { createOidcUpstream, type OidcAccountRecord, type OidcUpstream } from './oidc-upstream'

/** The atomic rate-limit mutation; same shape as in `email-code-limit.ts`. */
type ConsumeRateLimit = (
  key: string,
  rule: { window: number; max: number },
) => Promise<{ allowed: boolean; retryAfter: number | null }>

type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>

export interface OidcRuntime {
  /** Filled in `init`; throws `AUTH_OIDC_NOT_INITIALIZED` before. */
  upstream(): OidcUpstream
}

const OIDC_BACKCHANNEL_RATE_LIMIT = { window: 60, max: 600 }

/** The routes that may delete an `oidc` account: deleting the user. */
const OIDC_ACCOUNT_DELETE_PATHS = new Set(['/delete-user', '/delete-user/callback'])

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
}): { readonly plugin: BetterAuthPlugin; readonly runtime: OidcRuntime } {
  const client = getOidcClient(input.config)
  let upstream: OidcUpstream | null = null
  let logoutDeps: OidcBackchannelDeps | null = null

  const runtime: OidcRuntime = {
    upstream() {
      if (!upstream) throw new Error('AUTH_OIDC_NOT_INITIALIZED')
      return upstream
    },
  }

  const plugin: BetterAuthPlugin = {
    id: 'better-convex-oidc',
    init(ctx: AuthContext) {
      if (ctx.socialProviders.some((provider) => provider.id === OIDC_PROVIDER_ID)) {
        throw new Error('AUTH_OWNED_INVARIANT_VIOLATED')
      }
      // Better Auth replaces the internal adapter after every plugin init (F15): read it per call.
      const internalAdapter = () => ctx.internalAdapter

      const oidcAccounts = async (userId: string) =>
        (await internalAdapter().findAccounts(userId)).filter(
          (account) => account.providerId === OIDC_PROVIDER_ID,
        )
      const hasOidcAccount = async (userId: string) =>
        (await internalAdapter().findAccounts(userId)).some(
          (account) => account.providerId === OIDC_PROVIDER_ID,
        )

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
          // prettier-ignore
          const accounts = (await internalAdapter().findAccounts(userId)).filter((account) => account.providerId === OIDC_PROVIDER_ID)
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
        // prettier-ignore
        swapTokens: async (id, expectedRefreshToken, patch) => (await ctx.adapter.update({ model: 'account', where: [{ field: 'id', value: id }, { field: 'refreshToken', value: expectedRefreshToken }], update: patch })) !== null,
        endGrant,
        seal,
        open,
      })
      logoutDeps = {
        client,
        // prettier-ignore
        findUserIdBySubject: async (sub) => (await internalAdapter().findAccountByKey({ providerId: OIDC_PROVIDER_ID, accountId: await client.accountKey(sub) }))?.userId ?? null,
        endGrant,
        consume: input.consume(),
      }

      const databaseHooks: DatabaseHooks = {
        session: {
          create: {
            before: async (session, context) => {
              // prettier-ignore
              if (!isOidcCallback(context) && (await hasOidcAccount(session.userId))) throw oidcSignInRequired()
            },
          },
        },
        account: {
          create: {
            before: async (account) => {
              // prettier-ignore
              if (account.providerId === OIDC_PROVIDER_ID && (await hasOidcAccount(account.userId))) throw oidcAccountConflict()
            },
          },
          // Without its `oidc` row a user leaves the door guard, back-channel logout and the mint
          // liveness check. Only deleting the whole user may delete it: /unlink-account and Better
          // Auth's cleanup of unverified users at email-code sign-in may not.
          delete: {
            before: async (account, context) => {
              if (account.providerId !== OIDC_PROVIDER_ID || !context) return
              if (!OIDC_ACCOUNT_DELETE_PATHS.has(context.path)) throw oidcUnlinkRefused()
            },
          },
        },
      }

      return {
        context: {
          socialProviders: [createOidcProvider(client), ...ctx.socialProviders],
        },
        options: { databaseHooks },
      }
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
