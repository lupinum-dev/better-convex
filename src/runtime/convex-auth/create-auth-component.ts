/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 * Rewritten as the minimal packaged/local component client.
 *
 * Internal building block of createBetterConvexAuth; not a public entry.
 */
import {
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  type GenericActionCtx,
  type GenericDataModel,
  type HttpRouter,
  type PublicHttpAction,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'

import {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  PUBLIC_ORIGIN_HEADER,
  PUBLIC_ORIGIN_SIGNATURE_HEADER,
  VERIFIED_CLIENT_IP_HEADER,
  normalizeClientIp,
  verifySignedClientIp,
  verifySignedPublicOrigin,
} from '../shared/client-ip'
import { createConvexAuthAdapter } from './adapter/create-adapter'
import type { AuthCtx, WritableAuthCtx } from './context'
import { AUTH_CONFIG_INVALID, isLoggedAuthConfigError, logAuthFailure } from './diagnostics'
import { INTERNAL_SESSION_HEADER } from './internal-session'
import { rotateSigningKeyWithOfficialJwt } from './jwks-rotation'
import { requireAuthOrigin } from './origin'
import type {
  AuthAdapterComponentApi,
  AuthComponentTriggers,
  AuthFunctions,
  BetterConvexAuthSession,
  BetterConvexAuthUser,
  CreateAuth,
} from './types'

interface CreateAuthComponentOptions<DataModel extends GenericDataModel> {
  authFunctions?: AuthFunctions
  triggers?: AuthComponentTriggers<DataModel>
  /**
   * Site origins besides `SITE_URL` that this deployment serves. A route
   * accepts one of them only from a signed Nuxt proxy hop.
   */
  siteOrigins?: (ctx: AuthCtx<DataModel>) => Promise<ReadonlySet<string>>
}

/** A request-scoped Better Auth factory for one verified public origin. */
type CreateAuthForOrigin<DataModel extends GenericDataModel, Auth> = (
  ctx: AuthCtx<DataModel>,
  publicOrigin: string,
) => Auth | Promise<Auth>

class AuthRequestMetadataError extends Error {
  readonly code = 'AUTH_REQUEST_METADATA_INVALID'
}

class AuthSiteOriginError extends Error {
  constructor(
    readonly subCode: 'AUTH_CONFIG_SITE_ORIGINS_INVALID' | 'AUTH_CONFIG_SITE_ORIGIN_NOT_ALLOWED',
    cause?: unknown,
  ) {
    super(subCode, { cause })
  }
}

function authFailure(code: string): Response {
  return Response.json({ code }, { status: 500 })
}

function sessionRouteDenied(code: 'FORBIDDEN' | 'UNAUTHENTICATED', status: 401 | 403): Response {
  return Response.json({ code }, { headers: { 'cache-control': 'no-store' }, status })
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** What a session-authenticated HTTP action receives besides `ctx`. */
export interface BetterConvexHttpSession<Auth> {
  /** The request, rewritten to the public origin with the verified client IP. */
  readonly request: Request
  /** The request-scoped Better Auth instance. */
  readonly auth: Auth
  /**
   * Headers for server-side `auth.api` calls as this session: the session
   * cookie, the public origin, and the verified client IP.
   */
  readonly headers: Headers
  /** The admitted live user (same projection as `getUser`). */
  readonly user: BetterConvexAuthUser
  readonly sessionId: string
}

export type BetterConvexSessionHttpHandler<DataModel extends GenericDataModel, Auth> = (
  ctx: GenericActionCtx<DataModel>,
  session: BetterConvexHttpSession<Auth>,
) => Promise<Response>

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

/**
 * The public origin for this request: `SITE_URL`, or the origin that a signed
 * Nuxt proxy hop names when it is one of the configured site origins. An
 * unsigned or wrongly signed origin pair is rejected like a forged client IP.
 */
async function resolvePublicOrigin<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  request: Request,
  canonicalOrigin: string,
  siteOrigins: CreateAuthComponentOptions<DataModel>['siteOrigins'],
): Promise<string> {
  const origin = request.headers.get(PUBLIC_ORIGIN_HEADER)
  const signature = request.headers.get(PUBLIC_ORIGIN_SIGNATURE_HEADER)
  if (origin === null && signature === null) return canonicalOrigin
  const verified = await verifySignedPublicOrigin(
    origin,
    signature,
    process.env.BCN_AUTH_PROXY_IP_SECRET,
  )
  if (!verified) throw new AuthRequestMetadataError()
  if (verified === canonicalOrigin) return canonicalOrigin
  let allowed: ReadonlySet<string>
  try {
    allowed = siteOrigins ? await siteOrigins(ctx) : new Set()
  } catch (error) {
    throw new AuthSiteOriginError('AUTH_CONFIG_SITE_ORIGINS_INVALID', error)
  }
  if (!allowed.has(verified)) throw new AuthSiteOriginError('AUTH_CONFIG_SITE_ORIGIN_NOT_ALLOWED')
  return verified
}

async function prepareAuthRequest<
  DataModel extends GenericDataModel,
  Auth extends { $context: Promise<unknown> },
>(
  ctx: GenericActionCtx<GenericDataModel>,
  request: Request,
  createAuth: CreateAuthForOrigin<DataModel, Auth>,
  siteOrigins: CreateAuthComponentOptions<DataModel>['siteOrigins'],
  requireSameOrigin = false,
): Promise<
  Response | { auth: Auth; request: Request; publicOrigin: string; verifiedClientIp: string }
> {
  let canonicalOrigin: string
  try {
    canonicalOrigin = requireAuthOrigin('SITE_URL')
  } catch (error) {
    logAuthFailure(AUTH_CONFIG_INVALID, 'AUTH_CONFIG_ROUTE_SITE_URL_INVALID', error)
    return authFailure(AUTH_CONFIG_INVALID)
  }

  let verifiedClientIp: string
  let publicOrigin: string
  try {
    verifiedClientIp = await resolveVerifiedClientIp(
      request,
      async () => (await ctx.meta.getRequestMetadata()).ip,
      process.env.BCN_AUTH_PROXY_IP_SECRET,
    )
    publicOrigin = await resolvePublicOrigin(
      ctx as unknown as AuthCtx<DataModel>,
      request,
      canonicalOrigin,
      siteOrigins,
    )
  } catch (error) {
    if (error instanceof AuthSiteOriginError) {
      logAuthFailure(AUTH_CONFIG_INVALID, error.subCode, error.cause)
      return authFailure(AUTH_CONFIG_INVALID)
    }
    return authFailure('AUTH_REQUEST_METADATA_INVALID')
  }

  if (
    requireSameOrigin &&
    !SAFE_METHODS.has(request.method.toUpperCase()) &&
    request.headers.get('origin') !== publicOrigin
  ) {
    return sessionRouteDenied('FORBIDDEN', 403)
  }

  let auth: Auth
  try {
    auth = await createAuth(ctx as unknown as AuthCtx<DataModel>, publicOrigin)
    await auth.$context
  } catch (error) {
    if (!isLoggedAuthConfigError(error)) {
      logAuthFailure(AUTH_CONFIG_INVALID, 'AUTH_CONFIG_ROUTE_CONSTRUCTION_FAILED', error)
    }
    return authFailure(AUTH_CONFIG_INVALID)
  }

  try {
    return {
      auth,
      request: rewriteToPublicOrigin(request, publicOrigin, verifiedClientIp),
      publicOrigin,
      verifiedClientIp,
    }
  } catch (error) {
    // Route handlers include request rewriting in their handler failure mapping.
    if (requireSameOrigin) throw error
    logAuthFailure('AUTH_HANDLER_FAILED', 'AUTH_HANDLER_THREW', error)
    return authFailure('AUTH_HANDLER_FAILED')
  }
}

function identityClaim(identity: Record<string, unknown>, name: string): string | undefined {
  const value = identity[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The one error every session-requiring helper throws. */
export function unauthenticated(): ConvexError<{ code: 'UNAUTHENTICATED'; message: string }> {
  return new ConvexError({ code: 'UNAUTHENTICATED', message: 'Authentication required' })
}

/**
 * Read the Convex session claims. Only `token_use: 'convex-session'` tokens
 * qualify; OAuth access tokens and foreign JWTs never become a session.
 * This is claims-only and therefore not revocation-aware.
 */
export async function readSessionClaims(ctx: {
  auth: AuthCtx['auth']
}): Promise<BetterConvexAuthSession | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null
  const claims = identity as unknown as Record<string, unknown>
  if (identityClaim(claims, 'token_use') !== 'convex-session') return null
  const sessionId = identityClaim(claims, 'sid')
  const userId = identity.subject
  if (!sessionId || typeof userId !== 'string' || userId.length === 0) return null
  return { sessionId, userId }
}

function publicUser(user: Record<string, unknown>): BetterConvexAuthUser {
  // Library-owned security generations are admission state, not user data.
  return Object.fromEntries(
    Object.entries(user).filter(([field]) => !field.startsWith('bcn')),
  ) as BetterConvexAuthUser
}

export function createAuthComponent<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(component: Api, options: CreateAuthComponentOptions<DataModel> = {}) {
  // Exactly one component query: canonical session + user rows, expiry, and
  // the identity-generation fence are all checked inside sessionAdmission.
  const admitSession = async (ctx: AuthCtx<DataModel>) => {
    const session = await readSessionClaims(ctx)
    return session ? ctx.runQuery(component.adapter.sessionAdmission, session) : null
  }

  const getUser = async (ctx: AuthCtx<DataModel>): Promise<BetterConvexAuthUser | null> => {
    const admitted = await admitSession(ctx)
    return admitted ? publicUser(admitted.user) : null
  }

  return {
    adapter: (ctx: AuthCtx<DataModel>) =>
      createConvexAuthAdapter(ctx, component, {
        authFunctions: options.authFunctions,
        triggers: options.triggers,
      }),

    getUser,

    requireUser: async (ctx: AuthCtx<DataModel>): Promise<BetterConvexAuthUser> => {
      const user = await getUser(ctx)
      if (!user) throw unauthenticated()
      return user
    },

    getAuth: async <Auth>(
      createAuth: CreateAuth<DataModel, Auth>,
      ctx: WritableAuthCtx<DataModel>,
    ) => {
      const authenticated = await admitSession(ctx)
      if (!authenticated || typeof authenticated.session.token !== 'string') {
        throw unauthenticated()
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
        pruneSigningKeys: internalMutationGeneric({
          args: { batchSize: v.optional(v.number()) },
          handler: async (ctx, args) => ctx.runMutation(component.adapter.pruneSigningKeys, args),
        }),
        rotateSigningKey: signingKeyAction('rotate'),
      }
    },

    /**
     * An HTTP action behind the same hardening as the `/api/auth/*` routes:
     * signed client IP (or the direct Convex client IP), public-origin
     * rewrite, a same-origin check for unsafe methods, Better Auth's own
     * `get-session` exempt from rate limits (database read, no cookie cache), and the
     * library's session admission with identity-generation fencing.
     */
    sessionHttpAction: <
      Auth extends {
        $context: Promise<unknown>
        handler: (request: Request) => Promise<Response>
      },
    >(
      createAuth: CreateAuthForOrigin<DataModel, Auth>,
      handler: BetterConvexSessionHttpHandler<DataModel, Auth>,
    ): PublicHttpAction =>
      httpActionGeneric(async (ctx, request) => {
        const prepared = await prepareAuthRequest(
          ctx,
          request,
          createAuth,
          options.siteOrigins,
          true,
        )
        if (prepared instanceof Response) return prepared
        const { auth, request: forwarded, publicOrigin, verifiedClientIp } = prepared
        const headers = new Headers({
          origin: publicOrigin,
          [VERIFIED_CLIENT_IP_HEADER]: verifiedClientIp,
        })
        const cookie = forwarded.headers.get('cookie')
        if (cookie) headers.set('cookie', cookie)

        let sessionResponse: Response
        try {
          sessionResponse = await auth.handler(
            new Request(new URL('/api/auth/get-session?disableCookieCache=true', publicOrigin), {
              headers,
            }),
          )
        } catch (error) {
          logAuthFailure('AUTH_HANDLER_FAILED', 'AUTH_HANDLER_THREW', error)
          return authFailure('AUTH_HANDLER_FAILED')
        }
        // Preserve a handler's 429 response; the library exempts get-session from rate limits.
        if (sessionResponse.status === 429) return sessionResponse
        const body = sessionResponse.ok
          ? ((await sessionResponse.json().catch(() => null)) as {
              session?: { id?: unknown }
              user?: { id?: unknown }
            } | null)
          : null
        const sessionId = body?.session?.id
        const userId = body?.user?.id
        if (
          typeof sessionId !== 'string' ||
          sessionId.length === 0 ||
          typeof userId !== 'string' ||
          userId.length === 0
        ) {
          return sessionRouteDenied('UNAUTHENTICATED', 401)
        }
        const admitted = await ctx.runQuery(component.adapter.sessionAdmission, {
          sessionId,
          userId,
        })
        if (!admitted) return sessionRouteDenied('UNAUTHENTICATED', 401)

        return await handler(ctx as unknown as GenericActionCtx<DataModel>, {
          request: forwarded,
          auth,
          headers,
          user: publicUser(admitted.user),
          sessionId,
        })
      }),

    registerRoutes: <
      Auth extends {
        $context: Promise<unknown>
        handler: (request: Request) => Promise<Response>
      },
    >(
      http: HttpRouter,
      createAuth: CreateAuthForOrigin<DataModel, Auth>,
    ) => {
      const handler = httpActionGeneric(async (ctx, request) => {
        const prepared = await prepareAuthRequest(ctx, request, createAuth, options.siteOrigins)
        if (prepared instanceof Response) return prepared
        const { auth, request: forwarded } = prepared
        try {
          return await auth.handler(forwarded)
        } catch (error) {
          logAuthFailure('AUTH_HANDLER_FAILED', 'AUTH_HANDLER_THREW', error)
          return authFailure('AUTH_HANDLER_FAILED')
        }
      })
      http.route({ handler, method: 'GET', pathPrefix: '/api/auth/' })
      http.route({ handler, method: 'POST', pathPrefix: '/api/auth/' })
    },
  }
}
