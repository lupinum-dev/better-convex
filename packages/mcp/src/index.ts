/**
 * Application-facing identity provenance for one freshly verified MCP access token.
 *
 * This is not an application actor, role, permission grant, or authorization decision.
 * Applications map `(issuer, subject)` to canonical state and re-authorize every effect.
 */
export interface McpAccessContext {
  readonly issuer: string
  readonly subject: string
  readonly clientId: string
  readonly resource: string
  readonly scopes: readonly string[]
}

/**
 * Result returned by an access-token verifier.
 *
 * `access` is the normalized, credential-free identity provenance. `principal` is the verifier's
 * typed application principal for this token, for example the live grant a Convex verifier just
 * resolved. The package hands it unchanged to `requestState` and `configureServer`, so the
 * application never captures verifier state in a closure. It must never contain the raw token or
 * other provider secrets.
 */
export type VerifiedMcpAccess<Principal = undefined> = {
  readonly access: McpAccessContext
  readonly expiresAt: number
} & (undefined extends Principal
  ? { readonly principal?: Principal }
  : { readonly principal: Principal })

/** Captured verification target with a frozen outer record and a request-local resource clone. */
export interface McpVerificationExpectation {
  readonly issuer: string
  readonly resource: URL
}

/**
 * Provider-neutral token verifier consumed by the Better Convex MCP resource boundary.
 *
 * Implementations validate signature or introspection, token class, issuer, client, subject,
 * expiration, scopes, and the exact expected resource. Provider-private references remain inside
 * the adapter and never become part of {@link McpAccessContext}; the typed principal is the one
 * application-facing value a verifier adds.
 */
export interface McpAccessVerifier<Principal = undefined> {
  verifyAccessToken(
    token: string,
    expected: McpVerificationExpectation,
  ): Promise<VerifiedMcpAccess<Principal>>
}

export { handleMcpRequest, McpUnsupportedCapabilityError } from './handler.js'
export type {
  HandleMcpRequestOptions,
  McpConfigureServerContext,
  McpRequestStateContext,
  McpRequestTools,
} from './handler.js'
export { projectMcpToolError, runMcpTool } from './tools.js'
export type {
  McpToolErrorMetadata,
  McpToolResult,
  ProjectMcpToolErrorOptions,
  RunMcpToolOptions,
} from './tools.js'
export { defineMcpTool, registerMcpTool } from './define.js'
export type {
  DefinedMcpTool,
  McpToolConfig,
  McpToolDefinition,
  McpToolHandlerResult,
  McpToolRisk,
} from './define.js'
