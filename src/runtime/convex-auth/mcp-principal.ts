import type { GenericDataModel } from 'convex/server'
import { ConvexError, v } from 'convex/values'

import type { AuthCtx } from './context'
import { canonicalAuthIssuer } from './mcp-profile'
import { queryOAuthLiveGrant } from './oauth-live-access'
import type { AuthAdapterComponentApi, BetterConvexAuthUser } from './types'

/**
 * The live OAuth grant behind one verified MCP request. It is identity
 * provenance, not an authorization decision: pass it to an internal Convex
 * function and call `requireMcpPrincipal` there before any effect.
 * `expiresAt` is the access token expiry in epoch seconds.
 */
export interface BetterConvexMcpPrincipal {
  readonly kind: 'oauth'
  readonly userId: string
  readonly clientId: string
  readonly scopes: string[]
  readonly sessionId: string
  readonly grantId: string
  readonly issuer: string
  readonly resource: string
  readonly expiresAt: number
}

/** Argument validator for a {@link BetterConvexMcpPrincipal}. Use it only on internal functions. */
export const mcpPrincipalValidator = v.object({
  kind: v.literal('oauth'),
  userId: v.string(),
  clientId: v.string(),
  scopes: v.array(v.string()),
  sessionId: v.string(),
  grantId: v.string(),
  issuer: v.string(),
  resource: v.string(),
  expiresAt: v.number(),
})

export type McpAccessErrorCode = 'MCP_ACCESS_DENIED' | 'MCP_INSUFFICIENT_SCOPE'

function mcpError(
  code: McpAccessErrorCode,
  message: string,
): ConvexError<{ code: McpAccessErrorCode; message: string }> {
  return new ConvexError({ code, message })
}

function accessDenied() {
  return mcpError('MCP_ACCESS_DENIED', 'MCP access denied')
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function publicUser(user: Record<string, unknown>): BetterConvexAuthUser {
  // Library-owned security generations are admission state, not user data.
  return Object.fromEntries(
    Object.entries(user).filter(([field]) => !field.startsWith('bcn')),
  ) as BetterConvexAuthUser
}

/**
 * Re-validate an MCP principal inside the calling function's transaction
 * (one component query), then check `scope`. Throws
 * `ConvexError({ code: 'MCP_ACCESS_DENIED' })` for an expired, revoked,
 * disabled, or foreign grant and `ConvexError({ code: 'MCP_INSUFFICIENT_SCOPE' })`
 * when the grant lacks `scope`.
 */
export async function requireMcpPrincipal<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  component: AuthAdapterComponentApi,
  principal: BetterConvexMcpPrincipal,
  options: { readonly scope?: string; readonly resource?: () => URL } = {},
): Promise<{ readonly user: BetterConvexAuthUser; readonly principal: BetterConvexMcpPrincipal }> {
  if (
    !principal ||
    typeof principal !== 'object' ||
    principal.kind !== 'oauth' ||
    !nonEmptyString(principal.userId) ||
    !nonEmptyString(principal.clientId) ||
    !nonEmptyString(principal.sessionId) ||
    !nonEmptyString(principal.grantId) ||
    !nonEmptyString(principal.issuer) ||
    !nonEmptyString(principal.resource) ||
    !Array.isArray(principal.scopes) ||
    !Number.isSafeInteger(principal.expiresAt) ||
    principal.expiresAt * 1_000 <= Date.now()
  ) {
    throw accessDenied()
  }
  if (options.scope !== undefined && !nonEmptyString(options.scope)) {
    throw new TypeError('requireMcpPrincipal: "scope" must be a non-empty string')
  }
  // Configuration failures surface as configuration errors, never as access.
  const issuer = canonicalAuthIssuer()
  const resource = options.resource?.().href
  if (principal.issuer !== issuer || (resource !== undefined && principal.resource !== resource)) {
    throw accessDenied()
  }
  const grant = await queryOAuthLiveGrant(ctx, component, principal)
  if (!grant || grant.grantId !== principal.grantId) throw accessDenied()
  if (options.scope !== undefined && !principal.scopes.includes(options.scope)) {
    throw mcpError('MCP_INSUFFICIENT_SCOPE', `MCP scope "${options.scope}" is required`)
  }
  return Object.freeze({ user: publicUser(grant.user), principal })
}
