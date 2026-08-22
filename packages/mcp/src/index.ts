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
 * Safe result returned by a provider-neutral access-token verifier.
 *
 * Implementations return exactly these fields. Provider-private references stay in the verifier's
 * request-local closure and must not be attached to this value.
 */
export interface VerifiedMcpAccess {
  readonly access: McpAccessContext
  readonly expiresAt: number
}

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
 * the adapter and never become part of {@link McpAccessContext}.
 */
export interface McpAccessVerifier {
  verifyAccessToken(token: string, expected: McpVerificationExpectation): Promise<VerifiedMcpAccess>
}

export { handleMcpRequest, McpUnsupportedCapabilityError } from './handler.js'
export type { HandleMcpRequestOptions, McpRequestTools } from './handler.js'
export { runMcpTool } from './tools.js'
export type { McpToolErrorMetadata, RunMcpToolOptions } from './tools.js'
