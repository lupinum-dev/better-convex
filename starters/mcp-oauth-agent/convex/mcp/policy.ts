import type { McpScope } from './scopes'

export type McpRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface OAuthPrincipal {
  readonly clientId: string
  readonly issuer: string
  readonly resource: string
  readonly scopes: ReadonlySet<McpScope>
  readonly sessionId: string
  readonly subject: string
}

export interface SerializableOAuthPrincipal {
  clientId: string
  issuer: string
  resource: string
  scopes: McpScope[]
  sessionId: string
  subject: string
}

export interface LiveAuthorizationState {
  approval: null | {
    clientId: string
    expiresAt: number
    operation: 'projects.delete'
    organizationId: string
    projectId: string
    status: 'pending' | 'approved' | 'rejected' | 'used'
    userId: string
  }
  delegation: null | {
    clientId: string
    expiresAt: number
    organizationId: string
    scopes: readonly string[]
    status: 'active' | 'revoked'
    userId: string
  }
  membership: null | {
    organizationId: string
    role: McpRole
    status: 'active' | 'removed'
    userId: string
  }
  project: null | {
    id: string
    organizationId: string
    status: 'active' | 'deleted'
  }
  user: null | { active: boolean; authId: string; id: string }
}

export interface LiveAuthorizationRequirement {
  approvalId?: string
  minimumRole: McpRole
  organizationId: string
  projectId?: string
  scope: McpScope
}

export type McpAuthorizationCode =
  | 'MCP_ACCESS_REVOKED'
  | 'MCP_APPROVAL_REQUIRED'
  | 'MCP_RESOURCE_NOT_FOUND'
  | 'MCP_SCOPE_REQUIRED'

export class McpAuthorizationError extends Error {
  readonly code: McpAuthorizationCode

  constructor(code: McpAuthorizationCode) {
    super(code)
    this.name = 'McpAuthorizationError'
    this.code = code
  }
}

const ROLE_RANK: Record<McpRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
}

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value)
}

/**
 * Recompute application-owned access from one transactional snapshot. Provider-owned OAuth
 * authority is validated immediately before this function by authComponent.validateOAuthAccess.
 */
export function assertLiveMcpAuthorization(
  state: LiveAuthorizationState,
  principal: OAuthPrincipal,
  requirement: LiveAuthorizationRequirement,
  now = Date.now(),
): { role: McpRole; userId: string } {
  if (!state.user || !state.user.active || state.user.authId !== principal.subject) {
    throw new McpAuthorizationError('MCP_ACCESS_REVOKED')
  }

  const scope = requirement.scope
  if (!principal.scopes.has(scope)) {
    throw new McpAuthorizationError('MCP_SCOPE_REQUIRED')
  }

  if (
    !state.membership ||
    state.membership.status !== 'active' ||
    state.membership.organizationId !== requirement.organizationId ||
    state.membership.userId !== state.user.id ||
    ROLE_RANK[state.membership.role] < ROLE_RANK[requirement.minimumRole] ||
    !state.delegation ||
    state.delegation.status !== 'active' ||
    state.delegation.expiresAt <= now ||
    state.delegation.organizationId !== requirement.organizationId ||
    state.delegation.userId !== state.user.id ||
    state.delegation.clientId !== principal.clientId
  ) {
    throw new McpAuthorizationError('MCP_ACCESS_REVOKED')
  }
  if (!includes(state.delegation.scopes, scope)) {
    throw new McpAuthorizationError('MCP_SCOPE_REQUIRED')
  }

  if (requirement.projectId !== undefined) {
    if (
      !state.project ||
      state.project.id !== requirement.projectId ||
      state.project.organizationId !== requirement.organizationId ||
      state.project.status !== 'active'
    ) {
      throw new McpAuthorizationError('MCP_RESOURCE_NOT_FOUND')
    }
  }

  if (requirement.approvalId !== undefined) {
    if (
      !state.approval ||
      state.approval.status !== 'approved' ||
      state.approval.expiresAt <= now ||
      state.approval.operation !== 'projects.delete' ||
      state.approval.organizationId !== requirement.organizationId ||
      state.approval.projectId !== requirement.projectId ||
      state.approval.userId !== state.user.id ||
      state.approval.clientId !== principal.clientId
    ) {
      throw new McpAuthorizationError('MCP_APPROVAL_REQUIRED')
    }
  }

  return { role: state.membership.role, userId: state.user.id }
}

export function serializePrincipal(principal: OAuthPrincipal): SerializableOAuthPrincipal {
  return {
    clientId: principal.clientId,
    issuer: principal.issuer,
    resource: principal.resource,
    scopes: [...principal.scopes],
    sessionId: principal.sessionId,
    subject: principal.subject,
  }
}

export function deserializePrincipal(principal: SerializableOAuthPrincipal): OAuthPrincipal {
  return { ...principal, scopes: new Set<McpScope>(principal.scopes) }
}
