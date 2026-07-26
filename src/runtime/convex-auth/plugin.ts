import { oauthAuthorizationServerMetadata } from '@better-auth/oauth-provider'
import type { BetterAuthPlugin, Session, User } from 'better-auth'
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  sessionMiddleware,
} from 'better-auth/api'
import { decodeBasicCredentials } from 'better-auth/oauth2'
import { bearer } from 'better-auth/plugins'
import type { Jwk, JwtOptions } from 'better-auth/plugins/jwt'

import { hasBetterAuthCookie } from '../shared/auth-cookie'
import { VERIFIED_CLIENT_IP_HEADER } from '../shared/client-ip'
import { INTERNAL_SESSION_HEADER } from './internal-session'
import {
  assertSupportedJwksOptions,
  createPublicJwksResponse,
  rejectImplicitSigningKeyCreation,
  sanitizeStoredJwk,
} from './jwks-rotation'
import {
  assertSafePinnedClientProvisioning,
  assertSafePinnedClientUpdate,
  assertSafePinnedResourceProvisioning,
  validatePinnedOAuthProviderRuntime,
} from './oauth-provider-compat'
import {
  OAuthSecurityError,
  assertSafeStoredOAuthClient,
  assertSafeStoredOAuthClientResource,
  assertSafeStoredOAuthResource,
  hardenOAuthProviderCallbacks,
  installUrlCanParseCompatibility,
  parseBoundedFormBody,
  parseBoundedFormRequest,
  projectOAuthAuthorizationServerMetadata,
  requireSingleParameter,
  validateOAuthProviderProfile,
  type PinnedOAuthProviderProfile,
  type OAuthClientRecord,
  type OAuthClientResourceRecord,
  type OAuthResourceRecord,
} from './oauth-security'
import { normalizeAuthOrigin } from './origin'

type SessionJwtOptions = Pick<
  NonNullable<JwtOptions['jwt']>,
  'audience' | 'expirationTime' | 'issuer'
> & {
  definePayload?: (value: {
    session: Session & Record<string, unknown>
    user: User & Record<string, unknown>
  }) => Promise<Record<string, unknown>> | Record<string, unknown> | undefined
}

export interface ConvexAuthOptions {
  authConfig: {
    providers: readonly unknown[]
  }
  oauthProvider?: PinnedOAuthProviderProfile
  sessionJwt: SessionJwtOptions
}

const forbiddenCustomClaims = new Set(['aud', 'exp', 'iat', 'iss', 'jti', 'nbf', 'sub'])
const TOKEN_FIELDS = [
  'client_assertion',
  'client_assertion_type',
  'client_id',
  'client_secret',
  'code',
  'code_verifier',
  'grant_type',
  'redirect_uri',
  'refresh_token',
  'resource',
  'scope',
] as const
const REVOKE_FIELDS = [
  'client_assertion',
  'client_assertion_type',
  'client_id',
  'client_secret',
  'token',
  'token_type_hint',
] as const
const CODE_VERIFIER_PATTERN = /^[\w.~-]{43,128}$/u
const AUTHORIZE_BODY_MAX_BYTES = 8 * 1024

interface OAuthGuardContext {
  adapter: {
    findOne<T>(input: {
      model: string
      where: { field: string; operator?: string; value: unknown }[]
    }): Promise<T | null>
  }
  baseURL: string
}

function configureSharedJwks(
  context: Parameters<NonNullable<BetterAuthPlugin['init']>>[0],
  errorCode: string,
): void {
  const configuredPlugins = context.options.plugins ?? []
  const jwtIndexes = configuredPlugins
    .map((plugin, index) => (plugin.id === 'jwt' ? index : -1))
    .filter((index) => index >= 0)
  const convexIndexes = configuredPlugins
    .map((plugin, index) => (plugin.id === 'better-convex-nuxt' ? index : -1))
    .filter((index) => index >= 0)
  if (
    jwtIndexes.length !== 1 ||
    convexIndexes.length !== 1 ||
    jwtIndexes[0]! >= convexIndexes[0]!
  ) {
    throw new Error(errorCode)
  }

  const jwtPlugin = configuredPlugins[jwtIndexes[0]!] as BetterAuthPlugin & {
    options?: JwtOptions
  }
  const jwtOptions = jwtPlugin.options
  assertSupportedJwksOptions(jwtOptions, errorCode)
  if (
    !jwtOptions ||
    jwtOptions.adapter?.getJwks !== undefined ||
    jwtOptions.jwt?.audience !== context.baseURL ||
    jwtOptions.jwt.expirationTime !== '10m' ||
    jwtOptions.jwt.issuer !== context.baseURL
  ) {
    throw new Error(errorCode)
  }

  jwtOptions.adapter = {
    createJwk: rejectImplicitSigningKeyCreation,
    getJwks: async (endpointContext) => {
      const rows = (await endpointContext.context.adapter.findMany({
        model: 'jwks',
      })) as Jwk[]
      return rows.map((row) => sanitizeStoredJwk(row))
    },
  }
}

interface JwksReadContext {
  adapter: {
    findMany<T>(input: { model: string }): Promise<T[]>
  }
}

const officialBearerBefore = bearer().hooks.before[0]!
type BeforeHook = NonNullable<NonNullable<BetterAuthPlugin['hooks']>['before']>[number]

const internalSessionBearerBefore: BeforeHook = {
  matcher: (context) => {
    const headers = context.request?.headers ?? context.headers
    return headers?.get(INTERNAL_SESSION_HEADER) === '1' && officialBearerBefore.matcher(context)
  },
  handler: officialBearerBefore.handler,
}

const INVALID_SESSION_MESSAGE = 'AUTH_SESSION_INVALID'

function unauthorized(): never {
  throw new APIError('UNAUTHORIZED', { message: INVALID_SESSION_MESSAGE })
}

function unauthorizedResponse(): Response {
  return Response.json(
    { code: 'UNAUTHORIZED', message: INVALID_SESSION_MESSAGE },
    { headers: { 'Cache-Control': 'private, no-store' }, status: 401 },
  )
}

function hasPresentedSessionCredentials(headers: Headers): boolean {
  if (headers.has('authorization')) return true
  return hasBetterAuthCookie(headers.get('cookie'))
}

function validateSessionJwt(options: ConvexAuthOptions): void {
  const providers = options.authConfig.providers.filter(
    (provider): provider is Record<string, unknown> =>
      Boolean(
        provider &&
        typeof provider === 'object' &&
        (provider as Record<string, unknown>).applicationID === 'convex',
      ),
  )
  if (providers.length !== 1) throw new Error('AUTH_PROVIDER_INVALID')
  const provider = providers[0]!
  if (
    provider.type !== 'customJwt' ||
    provider.algorithm !== 'RS256' ||
    typeof options.sessionJwt.issuer !== 'string' ||
    provider.issuer !== options.sessionJwt.issuer ||
    options.sessionJwt.audience !== 'convex'
  ) {
    throw new Error('AUTH_SESSION_JWT_CONFIG_INVALID')
  }
  normalizeAuthOrigin(options.sessionJwt.issuer, 'CONVEX_SITE_URL')
  const lifetime = options.sessionJwt.expirationTime
  if (typeof lifetime !== 'string') throw new Error('AUTH_SESSION_JWT_LIFETIME_INVALID')
  const match = /^(\d+)(m|s)$/.exec(lifetime)
  if (!match) throw new Error('AUTH_SESSION_JWT_LIFETIME_INVALID')
  const seconds = Number(match[1]) * (match[2] === 'm' ? 60 : 1)
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 15 * 60) {
    throw new Error('AUTH_SESSION_JWT_LIFETIME_INVALID')
  }
}

function oauthFailure(error: string, status = 400): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Pragma: 'no-cache',
  })
  if (error === 'invalid_client') {
    headers.set('WWW-Authenticate', 'Basic realm="oauth2"')
  }
  return Response.json({ error }, { headers, status })
}

function oauthRequestPath(request: Request, baseURL: string): string | null {
  try {
    const requestUrl = new URL(request.url)
    const base = new URL(baseURL)
    if (requestUrl.origin !== base.origin) return null
    return requestUrl.pathname
  } catch {
    return null
  }
}

async function loadSafeOAuthBinding(
  context: OAuthGuardContext,
  options: PinnedOAuthProviderProfile,
  clientId: string,
  resourceId?: string,
): Promise<{ client: OAuthClientRecord; resource?: OAuthResourceRecord }> {
  const client = await context.adapter.findOne<OAuthClientRecord>({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  })
  if (!client) throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  try {
    assertSafeStoredOAuthClient(client, options.scopes!)
  } catch (error) {
    if (error instanceof OAuthSecurityError) {
      throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
    }
    throw error
  }
  if (resourceId === undefined) return { client }

  const resource = await context.adapter.findOne<OAuthResourceRecord>({
    model: 'oauthResource',
    where: [{ field: 'identifier', value: resourceId }],
  })
  const link = await context.adapter.findOne<OAuthClientResourceRecord>({
    model: 'oauthClientResource',
    where: [
      { field: 'clientId', value: clientId },
      { field: 'resourceId', value: resourceId },
    ],
  })
  if (!resource || !link) throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  try {
    assertSafeStoredOAuthResource(resource, options.scopes!)
    assertSafeStoredOAuthClientResource(link, clientId, resourceId)
  } catch (error) {
    if (error instanceof OAuthSecurityError) {
      throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
    }
    throw error
  }
  return { client, resource }
}

type GuardedClientAuthentication = {
  clientId: string
  method: 'client_secret_basic' | 'none'
}

function confidentialBasicClientId(request: Request): string {
  const authorization = request.headers.get('authorization')
  if (!authorization || authorization.includes(',') || !/^Basic \S+$/.test(authorization)) {
    throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  }
  try {
    const credentials = decodeBasicCredentials(authorization)
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
    }
    return credentials.clientId
  } catch {
    throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  }
}

function guardedClientAuthentication(
  request: Request,
  parameters: URLSearchParams,
): GuardedClientAuthentication {
  if (
    parameters.has('client_secret') ||
    parameters.has('client_assertion') ||
    parameters.has('client_assertion_type')
  ) {
    throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  }

  const bodyClientIds = parameters.getAll('client_id')
  const authorization = request.headers.get('authorization')
  if (bodyClientIds.length === 1) {
    if (bodyClientIds[0] === '' || authorization !== null) {
      throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
    }
    return { clientId: bodyClientIds[0]!, method: 'none' }
  }
  if (bodyClientIds.length !== 0) {
    throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  }
  return {
    clientId: confidentialBasicClientId(request),
    method: 'client_secret_basic',
  }
}

function assertClientAuthenticationMethod(
  client: OAuthClientRecord,
  authentication: GuardedClientAuthentication,
): void {
  if (
    (authentication.method === 'none' &&
      (client.public !== true ||
        client.tokenEndpointAuthMethod !== 'none' ||
        (client.clientSecret !== undefined && client.clientSecret !== null))) ||
    (authentication.method === 'client_secret_basic' &&
      (client.public !== false || client.tokenEndpointAuthMethod !== 'client_secret_basic'))
  ) {
    throw new OAuthSecurityError('AUTH_OAUTH_CLIENT_INVALID')
  }
}

function canonicalRedirectUrl(value: string): URL | null {
  if (value.includes('#')) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.href !== value || url.username || url.password || url.hash) return null
  return url
}

function matchesProviderRedirectUri(client: OAuthClientRecord, requested: string): boolean {
  if (!Array.isArray(client.redirectUris)) return false
  const requestedUrl = canonicalRedirectUrl(requested)
  if (!requestedUrl) return false
  if (client.redirectUris.includes(requested)) return true

  return client.redirectUris.some((registered) => {
    const registeredUrl = canonicalRedirectUrl(registered)
    if (!registeredUrl) return false
    const registeredLoopbackIp =
      registeredUrl.hostname === '127.0.0.1' || registeredUrl.hostname === '[::1]'
    return (
      registeredLoopbackIp &&
      registeredUrl.protocol === requestedUrl.protocol &&
      registeredUrl.hostname === requestedUrl.hostname &&
      registeredUrl.pathname === requestedUrl.pathname &&
      registeredUrl.search === requestedUrl.search
    )
  })
}

function assertRegisteredRedirectUri(client: OAuthClientRecord, redirectUri: string): void {
  if (!matchesProviderRedirectUri(client, redirectUri)) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
}

async function authorizeParameters(request: Request): Promise<URLSearchParams> {
  if (request.method === 'GET') return new URL(request.url).searchParams
  if (request.method !== 'POST') {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }

  return await parseBoundedFormBody(request, AUTHORIZE_BODY_MAX_BYTES)
}

function oauthAuthorizationFailure(
  redirectUri: string,
  state: string | null,
  issuer: string,
  description: string,
): Response {
  const location = new URL(redirectUri)
  location.searchParams.set('error', 'invalid_target')
  location.searchParams.set('error_description', description)
  if (state) location.searchParams.set('state', state)
  location.searchParams.set('iss', issuer)
  return new Response(null, {
    headers: {
      'Cache-Control': 'no-store',
      Location: location.toString(),
      Pragma: 'no-cache',
    },
    status: 302,
  })
}

/**
 * The provider owns authorization request parsing and OAuth error responses.
 * BCN adds only stored-profile and single-resource invariants the provider does
 * not expose as options. Once those are proven, the provider owns request
 * parsing, redirect matching, PKCE, scopes, and OAuth error semantics.
 */
async function guardAuthorizeProfile(
  request: Request,
  context: OAuthGuardContext,
  options: PinnedOAuthProviderProfile,
): Promise<Response | undefined> {
  const parameters = await authorizeParameters(request)

  const clientIds = parameters.getAll('client_id')
  const redirectUris = parameters.getAll('redirect_uri')
  if (redirectUris.length === 1 && !canonicalRedirectUrl(redirectUris[0]!)) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  if (clientIds.length !== 1) return

  const { client } = await loadSafeOAuthBinding(context, options, clientIds[0]!)
  const trustedRedirect =
    redirectUris.length === 1 && matchesProviderRedirectUri(client, redirectUris[0]!)
      ? redirectUris[0]!
      : null
  const resources = parameters.getAll('resource')
  let resourceErrorDescription = 'exactly one resource is required'
  if (resources.length === 1) {
    try {
      await loadSafeOAuthBinding(context, options, clientIds[0]!, resources[0]!)
      return
    } catch (error) {
      if (!(error instanceof OAuthSecurityError)) throw error
      resourceErrorDescription = 'requested resource is invalid'
    }
  }

  if (!trustedRedirect) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  const states = parameters.getAll('state')
  return oauthAuthorizationFailure(
    trustedRedirect,
    states.length === 1 ? states[0]! : null,
    context.baseURL,
    resourceErrorDescription,
  )
}

async function guardTokenRequest(
  request: Request,
  context: OAuthGuardContext,
  options: PinnedOAuthProviderProfile,
): Promise<void> {
  if (request.method !== 'POST' || request.headers.has('dpop')) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  const parameters = await parseBoundedFormRequest(request, TOKEN_FIELDS)
  const authentication = guardedClientAuthentication(request, parameters)
  if (
    requireSingleParameter(parameters, 'grant_type') !== 'authorization_code' ||
    parameters.has('refresh_token') ||
    parameters.has('scope')
  ) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  requireSingleParameter(parameters, 'code')
  const redirectUri = requireSingleParameter(parameters, 'redirect_uri')
  const verifier = requireSingleParameter(parameters, 'code_verifier')
  if (!CODE_VERIFIER_PATTERN.test(verifier)) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  const resourceId = requireSingleParameter(parameters, 'resource')
  const { client } = await loadSafeOAuthBinding(
    context,
    options,
    authentication.clientId,
    resourceId,
  )
  assertClientAuthenticationMethod(client, authentication)
  assertRegisteredRedirectUri(client, redirectUri)
}

async function guardRevokeRequest(
  request: Request,
  context: OAuthGuardContext,
  options: PinnedOAuthProviderProfile,
): Promise<void> {
  if (request.method !== 'POST' || request.headers.has('dpop')) {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  const parameters = await parseBoundedFormRequest(request, REVOKE_FIELDS)
  const authentication = guardedClientAuthentication(request, parameters)
  requireSingleParameter(parameters, 'token')
  const hint = parameters.get('token_type_hint')
  if (hint !== null && hint !== 'access_token') {
    throw new OAuthSecurityError('AUTH_OAUTH_REQUEST_INVALID')
  }
  const { client } = await loadSafeOAuthBinding(context, options, authentication.clientId)
  assertClientAuthenticationMethod(client, authentication)
}

function hasSafeGlobalAuthRuntime(
  context: Parameters<NonNullable<BetterAuthPlugin['init']>>[0],
): boolean {
  const ipAddress = context.options.advanced?.ipAddress
  const ipHeaders = ipAddress?.ipAddressHeaders
  const trustedProxies = ipAddress?.trustedProxies
  return (
    context.options.rateLimit?.enabled === true &&
    context.options.rateLimit.storage === 'database' &&
    context.options.rateLimit.modelName === 'rateLimit' &&
    context.options.rateLimit.customStorage === undefined &&
    context.options.rateLimit.customRules === undefined &&
    Array.isArray(ipHeaders) &&
    ipHeaders.length === 1 &&
    ipHeaders[0]?.toLowerCase() === VERIFIED_CLIENT_IP_HEADER &&
    (ipAddress?.disableIpTracking === undefined || ipAddress.disableIpTracking === false) &&
    (trustedProxies === undefined ||
      (Array.isArray(trustedProxies) && trustedProxies.length === 0)) &&
    (ipAddress?.ipv6Subnet === undefined || ipAddress.ipv6Subnet === 64) &&
    (context.options.advanced?.trustedProxyHeaders === undefined ||
      context.options.advanced.trustedProxyHeaders === false)
  )
}

export function convexAuth(options: ConvexAuthOptions): BetterAuthPlugin {
  validateSessionJwt(options)
  const oauthOptions = options.oauthProvider
  if (oauthOptions) installUrlCanParseCompatibility()
  const hardenedOAuth = oauthOptions ? hardenOAuthProviderCallbacks(oauthOptions) : undefined
  let providerRuntimeOptions: Record<string, unknown> | undefined

  return {
    id: 'better-convex-nuxt',
    rateLimit: [
      {
        pathMatcher: (path) => path === '/convex/token',
        window: 10,
        max: 300,
      },
    ],
    init: (context) => {
      configureSharedJwks(
        context,
        oauthOptions ? 'AUTH_OAUTH_CONFIG_INVALID' : 'AUTH_JWKS_CONFIG_INVALID',
      )
      if (!hasSafeGlobalAuthRuntime(context)) {
        if (oauthOptions) throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
        throw new Error('AUTH_CONFIG_INVALID')
      }
      if (!oauthOptions || !hardenedOAuth) {
        if ((context.options.plugins ?? []).some((plugin) => plugin.id === 'oauth-provider')) {
          throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
        }
        return
      }
      validateOAuthProviderProfile(oauthOptions)
      providerRuntimeOptions = validatePinnedOAuthProviderRuntime(
        context,
        oauthOptions,
        hardenedOAuth,
      )
    },
    onRequest: async (request, context) => {
      const path = oauthRequestPath(request, context.baseURL)
      const issuerPath = new URL(context.baseURL).pathname
      if (path === `${issuerPath}/jwks`) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return {
            response: new Response(null, {
              headers: { Allow: 'GET, HEAD', 'Cache-Control': 'private, no-store' },
              status: 405,
            }),
          }
        }
        try {
          const rows = await (context as unknown as JwksReadContext).adapter.findMany<Jwk>({
            model: 'jwks',
          })
          return { response: createPublicJwksResponse(rows, request.method) }
        } catch {
          return {
            response: new Response(null, {
              headers: { 'Cache-Control': 'private, no-store' },
              status: 500,
            }),
          }
        }
      }
      if (
        path === `${issuerPath}/convex/token` &&
        request.headers.has('authorization') &&
        request.headers.get(INTERNAL_SESSION_HEADER) !== '1'
      ) {
        return { response: unauthorizedResponse() }
      }
      if (
        request.method === 'GET' &&
        path === `${issuerPath}/convex/token` &&
        !hasPresentedSessionCredentials(request.headers)
      ) {
        return {
          response: Response.json(
            { token: null },
            { headers: { 'Cache-Control': 'private, no-store' } },
          ),
        }
      }
      if (!oauthOptions || !providerRuntimeOptions) return
      if (!path) return { response: oauthFailure('invalid_request') }
      const metadataPaths = new Set([
        `/.well-known/oauth-authorization-server${issuerPath}`,
        `${issuerPath}/.well-known/oauth-authorization-server`,
      ])
      try {
        if (metadataPaths.has(path)) {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return {
              response: new Response(null, {
                headers: { Allow: 'GET, HEAD' },
                status: 405,
              }),
            }
          }
          const official = oauthAuthorizationServerMetadata(
            { context } as Parameters<typeof oauthAuthorizationServerMetadata>[0],
            providerRuntimeOptions as unknown as Parameters<
              typeof oauthAuthorizationServerMetadata
            >[1],
          )
          const projected = projectOAuthAuthorizationServerMetadata(
            official,
            context.baseURL,
            oauthOptions.scopes!,
          )
          return {
            response:
              request.method === 'HEAD'
                ? new Response(null, {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                  })
                : Response.json(projected),
          }
        }
        if (path === `${issuerPath}/oauth2/authorize`) {
          const resourceFailure = await guardAuthorizeProfile(request, context, oauthOptions)
          if (resourceFailure) return { response: resourceFailure }
        } else if (path === `${issuerPath}/oauth2/token`) {
          await guardTokenRequest(request, context, oauthOptions)
        } else if (path === `${issuerPath}/oauth2/revoke`) {
          await guardRevokeRequest(request, context, oauthOptions)
        }
      } catch (error) {
        if (error instanceof OAuthSecurityError) {
          const invalidClient = error.code === 'AUTH_OAUTH_CLIENT_INVALID'
          return {
            response: oauthFailure(
              invalidClient ? 'invalid_client' : 'invalid_request',
              invalidClient ? 401 : 400,
            ),
          }
        }
        return { response: oauthFailure('server_error', 500) }
      }
    },
    hooks: {
      after: [
        {
          matcher: (context) => context.path === '/convex/token',
          handler: createAuthMiddleware(async (context) => {
            context.setHeader('Cache-Control', 'private, no-store')
          }),
        },
      ],
      before: [
        internalSessionBearerBefore,
        ...(oauthOptions
          ? [
              {
                matcher: (context: Parameters<BeforeHook['matcher']>[0]) =>
                  context.path === '/admin/oauth2/create-client' ||
                  context.path === '/admin/oauth2/update-client' ||
                  (context.path === '/admin/oauth2/resources' && context.method !== 'GET') ||
                  (context.path === '/admin/oauth2/resources/:identifier' &&
                    context.method !== 'GET' &&
                    context.method !== 'DELETE'),
                handler: createAuthMiddleware(async (context) => {
                  if (context.path === '/admin/oauth2/create-client') {
                    assertSafePinnedClientProvisioning(
                      context.method,
                      context.body,
                      oauthOptions.scopes!,
                    )
                  } else if (context.path === '/admin/oauth2/update-client') {
                    const body = context.body as { update?: unknown }
                    assertSafePinnedClientUpdate(context.method, body.update, oauthOptions.scopes!)
                  } else {
                    assertSafePinnedResourceProvisioning(
                      context.method,
                      context.body,
                      oauthOptions.scopes!,
                    )
                  }
                }),
              },
            ]
          : []),
      ],
    },
    endpoints: {
      getConvexToken: createAuthEndpoint(
        '/convex/token',
        {
          method: 'GET',
          requireHeaders: true,
          use: [sessionMiddleware],
          metadata: {
            openapi: {
              description: 'Issue a short-lived Convex session token',
              responses: {
                200: {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: {
                        properties: { token: { nullable: true, type: 'string' } },
                        required: ['token'],
                        type: 'object',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          ctx.setHeader('Cache-Control', 'private, no-store')
          const authenticated = ctx.context.session
          if (!authenticated || ctx.context.newSession) unauthorized()

          const persistedSession = await ctx.context.adapter.findOne<Session>({
            model: 'session',
            where: [
              { field: 'id', value: authenticated.session.id },
              { field: 'userId', value: authenticated.user.id },
              { field: 'expiresAt', operator: 'gt', value: new Date() },
            ],
          })
          if (
            !persistedSession ||
            persistedSession.token !== authenticated.session.token ||
            persistedSession.expiresAt.getTime() <= Date.now()
          ) {
            unauthorized()
          }

          const persistedUser = await ctx.context.adapter.findOne<User>({
            model: 'user',
            where: [{ field: 'id', value: persistedSession.userId }],
          })
          if (!persistedUser || persistedUser.id !== authenticated.user.id) unauthorized()

          const customClaims =
            (await options.sessionJwt.definePayload?.({
              session: persistedSession,
              user: persistedUser,
            })) ?? {}
          for (const claim of Object.keys(customClaims)) {
            if (forbiddenCustomClaims.has(claim)) {
              throw new Error(`AUTH_SESSION_JWT_RESERVED_CLAIM:${claim}`)
            }
          }

          const jwtPlugin = ctx.context.getPlugin('jwt')
          if (!jwtPlugin) throw new Error('AUTH_JWT_PLUGIN_REQUIRED')
          const result = await jwtPlugin.endpoints.signJWT({
            ...ctx,
            asResponse: false,
            body: {
              overrideOptions: {
                jwt: {
                  audience: options.sessionJwt.audience,
                  expirationTime: options.sessionJwt.expirationTime,
                  issuer: options.sessionJwt.issuer,
                },
              },
              payload: {
                ...customClaims,
                iat: Math.floor(Date.now() / 1000),
                sid: persistedSession.id,
                sub: persistedUser.id,
                token_use: 'convex-session',
              },
            },
            method: 'POST',
            returnHeaders: false,
            returnStatus: false,
          })
          return { token: result.token }
        },
      ),
    },
  }
}
