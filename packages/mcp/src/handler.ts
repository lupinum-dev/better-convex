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
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'

import {
  canonicalMcpIssuer,
  canonicalMcpResource,
  normalizeMcpScopes,
  verifyAndNormalizeMcpAccess,
} from './access.js'
import type { McpAccessContext, McpAccessVerifier, VerifiedMcpAccess } from './index.js'
import { runMcpTool, type McpToolErrorMetadata } from './tools.js'
import {
  boundMcpResponse,
  McpTransportFailure,
  mcpTransportFailureResponse,
  prepareBoundedMcpRequest,
  runMcpRequestDeadline,
} from './transport.js'

export interface McpRequestTools {
  runTool(name: string, operation: Parameters<typeof runMcpTool>[0]): ReturnType<typeof runMcpTool>
}

export interface HandleMcpRequestOptions {
  readonly serverInfo: {
    readonly name: string
    readonly version: string
  }
  readonly resource: URL
  readonly authorization:
    | {
        readonly mode: 'oauth'
        readonly issuer: string
        readonly verifier: McpAccessVerifier
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
        readonly verifier: McpAccessVerifier
        readonly requiredScopes?: readonly string[]
      }
  readonly configureServer: (
    access: McpAccessContext,
    server: McpServer,
    tools: McpRequestTools,
  ) => void | Promise<void>
  readonly onToolError?: (metadata: McpToolErrorMetadata) => void | Promise<void>
}

export async function handleMcpRequest(
  request: Request,
  options: HandleMcpRequestOptions,
): Promise<Response> {
  const expectedResource = new URL(canonicalMcpResource(options.resource))
  const authorization = normalizeAuthorization(options.authorization, expectedResource)
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
      const handler = createMcpHandler(
        async () => {
          const server = new McpServer(options.serverInfo)
          try {
            const tools: McpRequestTools = Object.freeze({
              runTool: (name: string, operation: Parameters<typeof runMcpTool>[0]) =>
                runMcpTool(operation, {
                  name,
                  ...(options.onToolError === undefined
                    ? {}
                    : { onToolError: options.onToolError }),
                }),
            })
            await options.configureServer(authenticated.access, server, tools)
            return hardenUnaryServer(server)
          } catch (error) {
            await server.close().catch(() => {})
            throw error
          }
        },
        {
          legacy: 'reject',
          maxSubscriptions: 0,
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
}

type NormalizedAuthorization =
  | {
      readonly mode: 'oauth'
      readonly issuer: string
      readonly verifier: McpAccessVerifier
      readonly metadataOptions: AuthMetadataOptions
      readonly resourceMetadataUrl: string
      readonly requiredScopes?: readonly string[]
    }
  | {
      readonly mode: 'preconfigured-bearer'
      readonly issuer: string
      readonly verifier: McpAccessVerifier
      readonly resourceMetadataUrl: undefined
      readonly requiredScopes?: readonly string[]
    }

function normalizeAuthorization(
  authorization: HandleMcpRequestOptions['authorization'],
  expectedResource: URL,
): NormalizedAuthorization {
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
