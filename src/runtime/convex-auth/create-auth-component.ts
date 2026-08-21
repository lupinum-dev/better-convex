/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 * Rewritten as the minimal packaged/local component client.
 */
import {
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  type GenericDataModel,
  type HttpRouter,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'

import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  VERIFIED_CLIENT_IP_HEADER,
  normalizeClientIp,
  verifySignedClientIp,
} from '../shared/client-ip'
import { createConvexAuthAdapter } from './adapter/create-adapter'
import type { AuthCtx, WritableAuthCtx } from './context'
import { INTERNAL_SESSION_HEADER } from './internal-session'
import { rotateSigningKeyWithOfficialJwt } from './jwks-rotation'
import { validateOAuthAccess, type OAuthLiveAccess } from './oauth-live-access'
import { requireAuthOrigin } from './origin'
import type {
  AuthAdapterComponentApi,
  AuthComponentTriggers,
  AuthFunctions,
  CreateAuth,
} from './types'

interface CreateAuthComponentOptions<DataModel extends GenericDataModel> {
  authFunctions?: AuthFunctions
  triggers?: AuthComponentTriggers<DataModel>
}

class AuthRequestMetadataError extends Error {
  readonly code = 'AUTH_REQUEST_METADATA_INVALID'
}

function authFailure(code: string): Response {
  return Response.json({ code }, { status: 500 })
}

function rewriteToPublicOrigin(
  request: Request,
  publicOrigin: string,
  verifiedClientIp: string,
): Request {
  const incoming = new URL(request.url)
  const target = new URL(publicOrigin)
  target.pathname = incoming.pathname
  target.search = incoming.search

  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('x-bcn-')) headers.delete(name)
  }
  headers.set(VERIFIED_CLIENT_IP_HEADER, verifiedClientIp)

  return new Request(new Request(target, request), { headers })
}

async function resolveVerifiedClientIp(
  request: Request,
  getDirectClientIp: () => Promise<string | null>,
  proxyIpSecret: string | undefined,
): Promise<string> {
  const clientIp = request.headers.get(CLIENT_IP_HEADER)
  const signature = request.headers.get(CLIENT_IP_SIGNATURE_HEADER)
  if (clientIp === null && signature === null) {
    const directClientIp = normalizeClientIp(await getDirectClientIp())
    if (!directClientIp) throw new AuthRequestMetadataError()
    return directClientIp
  }

  const forwardedClientIp = await verifySignedClientIp(clientIp, signature, proxyIpSecret)
  if (!forwardedClientIp) {
    throw new AuthRequestMetadataError()
  }
  return forwardedClientIp
}

function identityClaim(identity: Record<string, unknown>, name: string): string | undefined {
  const value = identity[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function createAuthComponent<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(component: Api, options: CreateAuthComponentOptions<DataModel> = {}) {
  const safeGetAuthSession = async (ctx: AuthCtx<DataModel>) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const claims = identity as unknown as Record<string, unknown>
    if (identityClaim(claims, 'token_use') !== 'convex-session') return null
    const sessionId = identityClaim(claims, 'sid')
    if (!sessionId) return null

    const session = (await ctx.runQuery(component.adapter.findOne, {
      model: 'session',
      where: [
        { field: 'id', value: sessionId },
        { field: 'userId', value: identity.subject },
        { field: 'expiresAt', operator: 'gt', value: Date.now() },
      ],
    })) as Record<string, unknown> | null
    return session ? { identity, session } : null
  }

  const safeGetAuthUser = async (ctx: AuthCtx<DataModel>) => {
    const authenticated = await safeGetAuthSession(ctx)
    if (!authenticated) return null
    return (await ctx.runQuery(component.adapter.findOne, {
      model: 'user',
      where: [{ field: 'id', value: authenticated.identity.subject }],
    })) as Record<string, unknown> | null
  }

  return {
    adapter: (ctx: AuthCtx<DataModel>) =>
      createConvexAuthAdapter(ctx, component, {
        authFunctions: options.authFunctions,
        triggers: options.triggers,
      }),

    safeGetAuthUser,

    getAuthUser: async (ctx: AuthCtx<DataModel>) => {
      const user = await safeGetAuthUser(ctx)
      if (!user) throw new ConvexError('Unauthenticated')
      return user
    },

    validateOAuthAccess: (ctx: AuthCtx<DataModel>, access: OAuthLiveAccess) =>
      validateOAuthAccess(ctx, component, access),

    getAuth: async <Auth>(
      createAuth: CreateAuth<DataModel, Auth>,
      ctx: WritableAuthCtx<DataModel>,
    ) => {
      const authenticated = await safeGetAuthSession(ctx)
      if (!authenticated || typeof authenticated.session.token !== 'string') {
        throw new ConvexError('Unauthenticated')
      }
      const auth = await createAuth(ctx)
      if (auth && typeof auth === 'object' && '$context' in auth) {
        await (auth as { $context: Promise<unknown> }).$context
      }
      return {
        auth,
        headers: new Headers({
          authorization: `Bearer ${authenticated.session.token}`,
          [INTERNAL_SESSION_HEADER]: '1',
        }),
      }
    },

    triggerFunctions: () => ({
      onCreate: internalMutationGeneric({
        args: { doc: v.any(), model: v.string() },
        handler: async (ctx, args) => options.triggers?.[args.model]?.onCreate?.(ctx, args.doc),
      }),
      onDelete: internalMutationGeneric({
        args: { doc: v.any(), model: v.string() },
        handler: async (ctx, args) => options.triggers?.[args.model]?.onDelete?.(ctx, args.doc),
      }),
      onUpdate: internalMutationGeneric({
        args: { model: v.string(), newDoc: v.any(), oldDoc: v.any() },
        handler: async (ctx, args) =>
          options.triggers?.[args.model]?.onUpdate?.(ctx, args.newDoc, args.oldDoc),
      }),
    }),

    jwksOperatorFunctions: <Auth>(createAuth: CreateAuth<DataModel, Auth>) => {
      const signingKeyAction = (mode: 'ensure' | 'rotate') =>
        internalActionGeneric({
          args: {},
          handler: async (ctx) => {
            const auth = await createAuth(ctx)
            if (!auth || typeof auth !== 'object' || !('$context' in auth)) {
              throw new Error('AUTH_JWT_PLUGIN_REQUIRED')
            }
            const authContext = await (
              auth as { $context: Promise<Parameters<typeof rotateSigningKeyWithOfficialJwt>[0]> }
            ).$context
            const jwtPlugin = authContext.getPlugin('jwt')
            if (!jwtPlugin) throw new Error('AUTH_JWT_PLUGIN_REQUIRED')
            const metadata = await rotateSigningKeyWithOfficialJwt(
              authContext,
              jwtPlugin.options,
              async (next) =>
                ctx.runMutation(component.adapter.rotateSigningKey, {
                  next,
                  onlyIfEmpty: mode === 'ensure',
                }),
            )
            return mode === 'ensure'
              ? { created: metadata.created !== false, kid: metadata.newKid }
              : metadata
          },
        })
      return {
        ensureSigningKey: signingKeyAction('ensure'),
        rotateSigningKey: signingKeyAction('rotate'),
      }
    },

    registerRoutes: <
      Auth extends {
        $context: Promise<unknown>
        handler: (request: Request) => Promise<Response>
      },
    >(
      http: HttpRouter,
      createAuth: CreateAuth<DataModel, Auth>,
    ) => {
      const handler = httpActionGeneric(async (ctx, request) => {
        let publicOrigin: string
        try {
          publicOrigin = requireAuthOrigin('SITE_URL')
        } catch {
          return authFailure('AUTH_CONFIG_INVALID')
        }

        let verifiedClientIp: string
        try {
          verifiedClientIp = await resolveVerifiedClientIp(
            request,
            async () => (await ctx.meta.getRequestMetadata()).ip,
            process.env.BCN_AUTH_PROXY_IP_SECRET,
          )
        } catch {
          return authFailure('AUTH_REQUEST_METADATA_INVALID')
        }

        let auth: Auth
        try {
          auth = await createAuth(ctx as unknown as AuthCtx<DataModel>)
          await auth.$context
        } catch {
          return authFailure('AUTH_CONFIG_INVALID')
        }
        try {
          return await auth.handler(rewriteToPublicOrigin(request, publicOrigin, verifiedClientIp))
        } catch {
          return authFailure('AUTH_HANDLER_FAILED')
        }
      })
      http.route({ handler, method: 'GET', pathPrefix: '/api/auth/' })
      http.route({ handler, method: 'POST', pathPrefix: '/api/auth/' })
    },
  }
}
