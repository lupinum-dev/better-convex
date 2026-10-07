import {
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  classifyInboundRequest,
  getOAuthProtectedResourceMetadataUrl,
  isJSONRPCErrorResponse,
  isLegacyRequest,
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  originValidationResponse,
  requireScopes,
  verifyBearerToken,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
  type AuthInfo,
  type AuthMetadataOptions,
  type OAuthTokenVerifier,
  type ScopeChallengeHandler,
  type ServerOptions,
} from '@modelcontextprotocol/server'

import {
  canonicalMcpIssuer,
  canonicalMcpResource,
  normalizeMcpScopes,
  verifyAndNormalizeMcpAccess,
} from './access.js'
import type {
  McpAccessContext,
  McpAccessVerifier,
  McpBearerAuthorization,
  McpOAuthAuthorization,
  VerifiedMcpAccess,
} from './access.js'
import { exposedMcpErrorCodes, runToolSafely, type McpToolErrorMetadata } from './errors.js'
import {
  boundMcpResponse,
  maximumMcpRequestBytes,
  McpTransportFailure,
  mcpTransportFailureResponse,
  prepareBoundedMcpRequest,
  runMcpRequestDeadline,
} from './transport.js'

export interface McpRequestTools {
  /** Runs a tool operation with this request's error projection (`exposeErrorCodes`) and
   * `onToolError` diagnostics. */
  runTool(
    name: string,
    operation: Parameters<typeof runToolSafely>[0],
  ): ReturnType<typeof runToolSafely>
  /** Official SDK `scopeChallenge` for a tool or resource that needs these scopes. The challenge
   * also names `authorization.requiredScopes`. Throws a `TypeError` for a scope that
   * `scopesSupported` does not advertise. */
  requireScopes(...scopes: readonly [string, ...string[]]): ScopeChallengeHandler
}

/** The freshly verified access and the verifier's typed principal for one MCP request. */
export interface McpRequestStateContext<Principal = undefined> {
  readonly access: McpAccessContext
  readonly principal: Principal
}

/** Everything `configureServer` needs to register this request's tools and resources. */
export interface McpConfigureServerContext<
  Principal = undefined,
> extends McpRequestStateContext<Principal> {
  readonly server: McpServer
  readonly tools: McpRequestTools
}

export interface HandleMcpRequestOptions<Principal = undefined> {
  readonly serverInfo: {
    readonly name: string
    readonly version: string
  }
  readonly resource: URL
  /** Build the official SDK's request-state verifier for this freshly authenticated principal.
   * The SDK verifies echoed state before dispatch and supplies its decoded value to the handler. */
  readonly requestState?: (
    context: McpRequestStateContext<Principal>,
  ) => Required<Pick<NonNullable<ServerOptions['requestState']>, 'verify'>>
  readonly authorization: McpOAuthAuthorization<Principal> | McpBearerAuthorization<Principal>
  /** Register this request's tools and resources. `principal` is the value the verifier resolved
   * for this token; pass it to Convex functions instead of re-deriving it. */
  readonly configureServer: (context: McpConfigureServerContext<Principal>) => void | Promise<void>
  /** `ConvexError` `data.code` values that `tools.runTool` projects to the client with their
   * message. `UNAUTHENTICATED`, `MCP_ACCESS_DENIED` and `MCP_INSUFFICIENT_SCOPE`
   * otherwise use static generic messages. */
  readonly exposeErrorCodes?: readonly string[]
  readonly onToolError?: (metadata: McpToolErrorMetadata) => void | Promise<void>
}

export async function handleMcpRequest<Principal = undefined>(
  request: Request,
  options: HandleMcpRequestOptions<Principal>,
): Promise<Response> {
  const expectedResource = new URL(canonicalMcpResource(options.resource))
  const authorization = normalizeAuthorization<Principal>(options.authorization, expectedResource)
  const exposeErrorCodes =
    options.exposeErrorCodes === undefined ? undefined : [...options.exposeErrorCodes]
  exposedMcpErrorCodes(exposeErrorCodes) // Reject an invalid allowlist before any request work.
  const requiredScopes =
    authorization.requiredScopes === undefined ? undefined : [...authorization.requiredScopes]

  try {
    return await runMcpRequestDeadline(request.signal, async (signal) => {
      const metadataResponse =
        authorization.mode === 'oauth'
          ? protectedResourceMetadataResponse(
              request,
              authorization.metadataOptions,
              authorization.resourceMetadataUrl,
            )
          : undefined
      if (metadataResponse) return await boundMcpResponse(metadataResponse, signal)
      const boundaryResponse = requestBoundaryResponse(request, expectedResource)
      if (boundaryResponse) return boundaryResponse
      const authenticated = await authenticateRequest(
        request.headers.get('authorization'),
        authorization.verifier,
        authorization.issuer,
        expectedResource,
        authorization.resourceMetadataUrl,
        requiredScopes,
      )
      if (authenticated instanceof Response) {
        return await boundMcpResponse(authenticated, signal)
      }

      const boundedRequest = await prepareBoundedMcpRequest(request, signal)
      const { access } = authenticated
      const principal = authenticated.principal as Principal
      const createServer = async () => {
        const server = new McpServer(options.serverInfo, {
          ...(options.requestState === undefined
            ? {}
            : { requestState: options.requestState(Object.freeze({ access, principal })) }),
        })
        try {
          const tools: McpRequestTools = Object.freeze({
            runTool: (name: string, operation: Parameters<typeof runToolSafely>[0]) =>
              runToolSafely(operation, {
                name,
                ...(exposeErrorCodes === undefined ? {} : { expose: exposeErrorCodes }),
                ...(options.onToolError === undefined ? {} : { onToolError: options.onToolError }),
              }),
            requireScopes: (...scopes: readonly [string, ...string[]]) =>
              requireEndpointScopes(authorization, scopes),
          })
          await options.configureServer(Object.freeze({ access, principal, server, tools }))
          return hardenUnaryServer(server)
        } catch (error) {
          await server.close().catch(() => {})
          throw error
        }
      }
      const authInfo = scopeChallengeAuthInfo(authenticated, authorization.resourceMetadataUrl)
      if (await isServedLegacyRequest(boundedRequest)) {
        return await boundMcpResponse(
          await serveLegacyRequest(await createServer(), boundedRequest, authInfo),
          signal,
        )
      }
      const handler = createMcpHandler(createServer, {
        legacy: 'reject',
        maxRequestBodySize: maximumMcpRequestBytes,
        maxSubscriptions: 0,
        responseMode: 'json',
      })
      try {
        const inspection =
          boundedRequest.headers.get('mcp-method') === 'subscriptions/listen'
            ? boundedRequest.clone()
            : undefined
        const response = await boundMcpResponse(
          await handler.fetch(boundedRequest, { authInfo }),
          signal,
        )
        return inspection ? await rejectUnavailableSubscription(inspection, response) : response
      } finally {
        await handler.close()
      }
    })
  } catch (error) {
    if (error instanceof McpTransportFailure) return mcpTransportFailureResponse(error)
    throw error
  }
}

/**
 * A 2025-era request this handler serves: valid JSON without the 2026 envelope claim. A request
 * with the 2026 `mcp-method` header, or a body that is not JSON, goes to the modern path, which
 * answers it with the SDK's own protocol error.
 */
async function isServedLegacyRequest(request: Request): Promise<boolean> {
  if (request.headers.has('mcp-method')) return false
  try {
    JSON.parse(await request.clone().text())
  } catch {
    return false
  }
  return await isLegacyRequest(request)
}

/**
 * Serves one 2025-era request (Claude, ChatGPT and most hosts today) statelessly, with a JSON
 * response. The SDK's own legacy fallback answers with an event stream, which the response bound
 * refuses, and has no option for JSON, so this leg builds the transport itself.
 */
async function serveLegacyRequest(
  server: McpServer,
  request: Request,
  authInfo: AuthInfo,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: maximumMcpRequestBytes,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(request, { authInfo })
  } finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

/** SDK 2.1.0 still intercepts subscriptions before dispatch, even with no advertised capability.
 * Correct only its exact zero-capacity response after the SDK's request validation.
 * Remove with the SDK disable-subscriptions fix. */
async function rejectUnavailableSubscription(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status !== 200 || request.headers.get('mcp-method') !== 'subscriptions/listen')
    return response
  let body: unknown
  let result: unknown
  try {
    body = await request.json()
    result = await response.clone().json()
  } catch {
    return response
  }
  const classified = classifyInboundRequest({
    httpMethod: request.method,
    protocolVersionHeader: request.headers.get('mcp-protocol-version') ?? undefined,
    mcpMethodHeader: request.headers.get('mcp-method') ?? undefined,
    mcpNameHeader: request.headers.get('mcp-name') ?? undefined,
    body,
  })
  if (
    classified.kind !== 'modern' ||
    classified.messageKind !== 'request' ||
    classified.message.method !== 'subscriptions/listen' ||
    !isJSONRPCErrorResponse(result) ||
    result.id !== classified.message.id ||
    result.error.code !== -32603 ||
    result.error.message !== 'Subscription limit reached'
  )
    return response
  return Response.json(
    { jsonrpc: '2.0', id: result.id, error: { code: -32601, message: 'Method not found' } },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  )
}

/** The SDK challenges with exactly the scopes that one tool or resource declares. Add the base
 * scopes, so a client that authorizes again for the challenge keeps the access it already has.
 * Discovery must advertise every scope that a challenge can ask for, checked at registration. */
function requireEndpointScopes(
  authorization: Pick<NormalizedAuthorization, 'requiredScopes' | 'scopesSupported'>,
  scopes: readonly [string, ...string[]],
): ScopeChallengeHandler {
  const { requiredScopes = [], scopesSupported } = authorization
  if (scopesSupported && scopes.some((scope) => !scopesSupported.includes(scope)))
    throw new TypeError('MCP scope challenges must be advertised as supported')
  const challenged = [...new Set([...requiredScopes, ...scopes])] as [string, ...string[]]
  return requireScopes(...challenged)
}

/** Verified scopes and metadata URL for the SDK's `scopeChallenge` checks. Tool callbacks also
 * receive this value as `ctx.http.authInfo`, so the raw bearer never leaves authentication.
 * Omitting `resource` keeps preconfigured-bearer challenges free of discovery metadata. */
function scopeChallengeAuthInfo(
  verified: VerifiedMcpAccess<unknown>,
  resourceMetadataUrl: string | undefined,
): AuthInfo {
  return {
    token: '',
    clientId: verified.access.clientId,
    scopes: [...verified.access.scopes],
    expiresAt: verified.expiresAt,
    ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
  }
}

type NormalizedAuthorization<Principal = unknown> =
  | {
      readonly mode: 'oauth'
      readonly issuer: string
      readonly verifier: McpAccessVerifier<Principal>
      readonly metadataOptions: AuthMetadataOptions
      readonly resourceMetadataUrl: string
      readonly requiredScopes?: readonly string[]
      readonly scopesSupported?: readonly string[]
    }
  | {
      readonly mode: 'preconfigured-bearer'
      readonly issuer: string
      readonly verifier: McpAccessVerifier<Principal>
      readonly resourceMetadataUrl: undefined
      readonly requiredScopes?: readonly string[]
      readonly scopesSupported?: undefined
    }

function normalizeAuthorization<Principal>(
  authorization: HandleMcpRequestOptions<Principal>['authorization'],
  expectedResource: URL,
): NormalizedAuthorization<Principal> {
  if (authorization.mode === 'preconfigured-bearer') {
    const issuer = canonicalMcpIssuer(authorization.issuer)
    const requiredScopes = normalizeConfiguredScopes(authorization.requiredScopes)
    return Object.freeze({
      mode: authorization.mode,
      issuer,
      verifier: authorization.verifier,
      resourceMetadataUrl: undefined,
      ...(requiredScopes === undefined ? {} : { requiredScopes }),
    })
  }

  const issuer = canonicalMcpIssuer(authorization.issuer)
  const requiredScopes = normalizeConfiguredScopes(authorization.requiredScopes)
  const scopesSupported = normalizeConfiguredScopes(authorization.scopesSupported)
  if (
    requiredScopes !== undefined &&
    scopesSupported !== undefined &&
    requiredScopes.some((scope) => !scopesSupported.includes(scope))
  ) {
    throw new TypeError('MCP required scopes must be advertised as supported')
  }
  const metadataOptions: AuthMetadataOptions = {
    oauthMetadata: { issuer } as AuthMetadataOptions['oauthMetadata'],
    resourceServerUrl: new URL(expectedResource.href),
    ...(authorization.resourceName === undefined
      ? {}
      : { resourceName: authorization.resourceName }),
    ...(scopesSupported === undefined ? {} : { scopesSupported: [...scopesSupported] }),
    ...(new URL(issuer).protocol === 'http:' ? { dangerouslyAllowInsecureIssuerUrl: true } : {}),
  }
  buildOAuthProtectedResourceMetadata(metadataOptions)
  return Object.freeze({
    mode: authorization.mode,
    issuer,
    verifier: authorization.verifier,
    metadataOptions,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(expectedResource),
    ...(requiredScopes === undefined ? {} : { requiredScopes }),
    ...(scopesSupported === undefined ? {} : { scopesSupported }),
  })
}

function normalizeConfiguredScopes(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeMcpScopes(value)
  if (normalized.length !== value.length) {
    throw new TypeError('MCP configured scopes must be unique')
  }
  return normalized
}

function protectedResourceMetadataResponse(
  request: Request,
  options: AuthMetadataOptions,
  resourceMetadataUrl: string,
): Response | undefined {
  const actual = new URL(request.url)
  const expected = new URL(resourceMetadataUrl)
  if (
    actual.origin !== expected.origin ||
    normalizeRoutingPath(actual.pathname) !== normalizeRoutingPath(expected.pathname)
  ) {
    return undefined
  }
  return oauthMetadataResponse(request, options)
}

function requestBoundaryResponse(request: Request, expectedResource: URL): Response | undefined {
  const url = new URL(request.url)
  if (
    url.origin !== expectedResource.origin ||
    normalizeRoutingPath(url.pathname) !== normalizeRoutingPath(expectedResource.pathname) ||
    url.search !== expectedResource.search
  ) {
    return emptyFailure(404)
  }
  if (request.method !== 'POST') return emptyFailure(405)
  if (request.headers.has('content-encoding')) return emptyFailure(415)
  const originRejected = originValidationResponse(request, [])
  if (originRejected) return emptyFailure(originRejected.status)
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return emptyFailure(415)
  }
  return undefined
}

function normalizeRoutingPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function emptyFailure(status: number): Response {
  return new Response(null, {
    headers: { 'cache-control': 'no-store' },
    status,
  })
}

async function authenticateRequest<Principal>(
  authorizationHeader: string | null,
  verifier: McpAccessVerifier<Principal>,
  expectedIssuer: string,
  expectedResource: URL,
  resourceMetadataUrl: string | undefined,
  requiredScopes: string[] | undefined,
): Promise<VerifiedMcpAccess<Principal> | Response> {
  let verified: VerifiedMcpAccess<Principal> | undefined
  const officialVerifier: OAuthTokenVerifier = {
    async verifyAccessToken(token): Promise<AuthInfo> {
      try {
        verified = await verifyAndNormalizeMcpAccess({
          verifier,
          token,
          expectedIssuer,
          expectedResource,
        })
      } catch {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token')
      }
      return {
        token,
        clientId: verified.access.clientId,
        scopes: [...verified.access.scopes],
        expiresAt: verified.expiresAt,
        resource: new URL(verified.access.resource),
      }
    },
  }

  try {
    await verifyBearerToken(authorizationHeader, {
      verifier: officialVerifier,
      requiredScopes,
    })
  } catch (error) {
    return bearerAuthChallengeResponse(error, {
      ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }),
      requiredScopes,
    })
  }
  return (
    verified ??
    bearerAuthChallengeResponse(
      new Error('Missing verified access result'),
      resourceMetadataUrl === undefined ? undefined : { resourceMetadataUrl },
    )
  )
}

export class McpUnsupportedCapabilityError extends Error {
  readonly code = 'MCP_UNSUPPORTED_SERVER_CAPABILITY'

  constructor(readonly unsupportedCapabilities: readonly string[]) {
    super(`MCP server advertised unsupported capabilities: ${unsupportedCapabilities.join(', ')}`)
    this.name = 'McpUnsupportedCapabilityError'
  }
}

function hardenUnaryServer(server: McpServer): McpServer {
  const protocol = server.server
  const capabilities = protocol.getCapabilities()
  const unsupported = Object.keys(capabilities).filter(
    (capability) => capability !== 'tools' && capability !== 'resources',
  )
  if (unsupported.length > 0) {
    throw new McpUnsupportedCapabilityError(Object.freeze([...unsupported]))
  }
  protocol.registerCapabilities({
    ...(capabilities.resources === undefined
      ? {}
      : {
          resources: {
            ...capabilities.resources,
            listChanged: false,
            subscribe: false,
          },
        }),
    ...(capabilities.tools === undefined
      ? {}
      : {
          tools: {
            ...capabilities.tools,
            listChanged: false,
          },
        }),
  })
  return server
}
