export { defineAuthAdapterFunctions } from './adapter/define-functions'
export { createBetterConvexAuth } from './create-better-convex-auth'
export type {
  BetterConvexAccountPolicy,
  BetterConvexAuth,
  BetterConvexAuthEmail,
  BetterConvexAuthEmailSender,
  BetterConvexAuthEmailType,
  BetterConvexAuthEmailUser,
  BetterConvexAuthInstance,
  BetterConvexMcp,
  BetterConvexMcpAuthorization,
  BetterConvexOrganizationAuthInstance,
  BetterConvexSessionPolicy,
  BetterConvexTeamOrganizationAuthInstance,
  CreateBetterConvexAuthOptions,
} from './create-better-convex-auth'
export type {
  BetterConvexOAuthOperator,
  BetterConvexPublicOAuthClientInput,
} from './oauth-operator'
export type { BetterConvexOAuthConnection, BetterConvexOAuthConnections } from './oauth-connections'
export { mcpPrincipalValidator } from './mcp-principal'
export type { BetterConvexMcpPrincipal, McpAccessErrorCode } from './mcp-principal'
export type { BetterConvexMcpHost, BetterConvexMcpOptions } from './mcp-profile'
export { getConvexAuthProvider } from './provider'
export { requireAuthOrigin } from './origin'
export { createUserProjectionTriggers } from './user-projection'
export { findAccountKeyCollisions } from './adapter/account-key-collisions'
export type {
  AccountKeyCollision,
  AccountKeyCollisionReport,
  FindAccountKeyCollisionsOptions,
} from './adapter/account-key-collisions'

export type { AuthCtx, WritableAuthCtx } from './context'
export type {
  BetterConvexHttpSession,
  BetterConvexSessionHttpHandler,
} from './create-auth-component'
export type {
  AuthComponentTriggers,
  AuthFunctions,
  BetterConvexAuthUser,
  CreateAuth,
} from './types'
export type {
  BetterAuthMcpAccessVerifierOptions,
  BetterConvexMcpAccessVerifier,
  VerifiedBetterConvexMcpAccess,
} from './oauth-resource'
export type {
  BetterAuthUserProjectionSource,
  CreateUserProjectionTriggersOptions,
} from './user-projection'
