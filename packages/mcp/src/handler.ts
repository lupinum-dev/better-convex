import {
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  originValidationResponse,
  verifyBearerToken,
  McpServer,
  type AuthInfo,
  type AuthMetadataOptions,
  type McpRequestContext,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'

import { verifyAndNormalizeMcpAccess } from './access.js'
import type { McpAccessContext, McpAccessVerifier, VerifiedMcpAccess } from './index.js'
import {
  boundMcpResponse,
  McpTransportFailure,
  mcpTransportFailureResponse,
  prepareBoundedMcpRequest,
  runMcpRequestDeadline,
} from './transport.js'

export interface ConvexMcpRequestContext {
  readonly era: McpRequestContext['era']
}

export interface ConvexMcpHandlerOptions<ActionContext> {
  readonly serverInfo: {
    readonly name: string
    readonly version: string
  }
  readonly resource: URL
  readonly verifier: McpAccessVerifier
  readonly authorization:
    | {
        readonly mode: 'oauth'
        readonly metadata: OAuthMetadata
        readonly resourceName?: string
        readonly requiredScopes?: readonly string[]
        readonly scopesSupported?: readonly string[]
      }
    | {
        /**
         * Preconfigured bearer credentials are provisioned out of band by the application. This
         * mode deliberately does not publish OAuth discovery metadata.
         */
        readonly mode: 'preconfigured-bearer'
        readonly issuer: string
        readonly requiredScopes?: readonly string[]
      }
  readonly configureServer: (
    context: ActionContext,
    access: McpAccessContext,
    request: ConvexMcpRequestContext,
    server: McpServer,
  ) => void | Promise<void>
}

export interface ConvexMcpHandler<ActionContext> {
  fetch(context: ActionContext, request: Request): Promise<Response>
}

export function createConvexMcpHandler<ActionContext>(
  options: ConvexMcpHandlerOptions<ActionContext>,
): ConvexMcpHandler<ActionContext> {
  const expectedResource = new URL(options.resource.href)
  const authorization = normalizeAuthorization(options.authorization, expectedResource)
  const requiredScopes =
    authorization.requiredScopes === undefined ? undefined : [...authorization.requiredScopes]

  return Object.freeze({
    async fetch(context: ActionContext, request: Request): Promise<Response> {
      try {
        return await runMcpRequestDeadline(request.signal, async (signal) => {
          const metadataResponse =
            authorization.mode === 'oauth'
              ? oauthMetadataResponse(request, authorization.metadataOptions)
              : undefined
          if (metadataResponse) return await boundMcpResponse(metadataResponse, signal)
          const boundaryResponse = requestBoundaryResponse(request, expectedResource)
          if (boundaryResponse) return boundaryResponse
          const authenticated = await authenticateRequest(
            request.headers.get('authorization'),
            options.verifier,
            authorization.issuer,
            expectedResource,
            authorization.resourceMetadataUrl,
            requiredScopes,
          )
          if (authenticated instanceof Response) {
            return await boundMcpResponse(authenticated, signal)
          }

          const boundedRequest = await prepareBoundedMcpRequest(request, signal)
          if (await containsStatefulMcpMethod(boundedRequest)) return emptyFailure(405)
          const handler = createMcpHandler(
            async ({ era }) => {
              const server = new McpServer(options.serverInfo)
              await options.configureServer(context, authenticated.access, { era }, server)
              return hardenUnaryServer(server)
            },
            {
              legacy: 'reject',
              responseMode: 'json',
            },
          )
          try {
            return await boundMcpResponse(await handler.fetch(boundedRequest), signal)
          } finally {
            await handler.close()
          }
        })
      } catch (error) {
        if (error instanceof McpTransportFailure) return mcpTransportFailureResponse(error)
        throw error
      }
    },
  })
}

type NormalizedAuthorization =
  | {
      readonly mode: 'oauth'
      readonly issuer: string
      readonly metadataOptions: AuthMetadataOptions
      readonly resourceMetadataUrl: string
      readonly requiredScopes?: readonly string[]
    }
  | {
      readonly mode: 'preconfigured-bearer'
      readonly issuer: string
      readonly resourceMetadataUrl: undefined
      readonly requiredScopes?: readonly string[]
    }

function normalizeAuthorization(
  authorization: ConvexMcpHandlerOptions<unknown>['authorization'],
  expectedResource: URL,
): NormalizedAuthorization {
  if (authorization.mode === 'preconfigured-bearer') {
    const issuer = canonicalAuthorizationIssuer(authorization.issuer)
    return Object.freeze({
      mode: authorization.mode,
      issuer,
      resourceMetadataUrl: undefined,
      ...(authorization.requiredScopes === undefined
        ? {}
        : { requiredScopes: Object.freeze([...authorization.requiredScopes]) }),
    })
  }

  const metadataOptions: AuthMetadataOptions = {
    oauthMetadata: structuredClone(authorization.metadata),
    resourceServerUrl: new URL(expectedResource.href),
    ...(authorization.resourceName === undefined
      ? {}
      : { resourceName: authorization.resourceName }),
    ...(authorization.scopesSupported === undefined
      ? {}
      : { scopesSupported: [...authorization.scopesSupported] }),
  }
  buildOAuthProtectedResourceMetadata(metadataOptions)
  return Object.freeze({
    mode: authorization.mode,
    issuer: metadataOptions.oauthMetadata.issuer,
    metadataOptions,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(expectedResource),
    ...(authorization.requiredScopes === undefined
      ? {}
      : { requiredScopes: Object.freeze([...authorization.requiredScopes]) }),
  })
}

function canonicalAuthorizationIssuer(value: string): string {
  const issuer = new URL(value)
  if (
    issuer.protocol !== 'https:' ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.href !== value
  ) {
    throw new TypeError('Invalid access issuer')
  }
  return value
}

function requestBoundaryResponse(request: Request, expectedResource: URL): Response | undefined {
  const url = new URL(request.url)
  if (url.href !== expectedResource.href) return emptyFailure(404)
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

function emptyFailure(status: number): Response {
  return new Response(null, {
    headers: { 'cache-control': 'no-store' },
    status,
  })
}

async function authenticateRequest(
  authorizationHeader: string | null,
  verifier: McpAccessVerifier,
  expectedIssuer: string,
  expectedResource: URL,
  resourceMetadataUrl: string | undefined,
  requiredScopes: string[] | undefined,
): Promise<VerifiedMcpAccess | Response> {
  let verified: VerifiedMcpAccess | undefined
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

const STATEFUL_MCP_METHODS = new Set([
  'resources/subscribe',
  'resources/unsubscribe',
  'subscriptions/listen',
])

async function containsStatefulMcpMethod(request: Request): Promise<boolean> {
  try {
    const value = (await request.clone().json()) as unknown
    const messages = Array.isArray(value) ? value : [value]
    return messages.some((message) => {
      if (typeof message !== 'object' || message === null) return false
      const method = Reflect.get(message, 'method')
      return typeof method === 'string' && STATEFUL_MCP_METHODS.has(method)
    })
  } catch {
    return false
  }
}

function hardenUnaryServer(server: McpServer): McpServer {
  const protocol = server.server
  const capabilities = protocol.getCapabilities()
  const unsupported = Object.keys(capabilities).filter(
    (capability) => capability !== 'tools' && capability !== 'resources',
  )
  if (unsupported.length > 0) {
    throw new TypeError('MCP_UNSUPPORTED_SERVER_CAPABILITY')
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
