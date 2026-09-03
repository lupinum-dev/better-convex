export { defineAuthAdapterFunctions } from './adapter/define-functions'
export { createAuthComponent } from './create-auth-component'
export { createBetterConvexAuth } from './create-better-convex-auth'
export { createWorkforceAuthSchemaOptions } from './workforce/profile'
export type {
  BetterConvexAuth,
  BetterConvexAuthInstance,
  BetterConvexOrganizationAuthInstance,
  CreateBetterConvexAuthOptions,
} from './create-better-convex-auth'
export type {
  BetterConvexOAuthOperator,
  BetterConvexPublicOAuthClientInput,
} from './oauth-operator'
export { requireAuthOrigin } from './origin'
export { requireWritableAuthCtx } from './context'
export { convexAuth } from './plugin'
export { getConvexAuthProvider } from './provider'
export { createBetterAuthMcpAccessVerifier, verifyOAuthBearerToken } from './oauth-resource'
export { createUserProjectionTriggers } from './user-projection'

export type { AuthCtx, WritableAuthCtx } from './context'
export type { AuthComponentTriggers, AuthFunctions, CreateAuth } from './types'
export type {
  BetterAuthMcpAccessVerifierOptions,
  VerifyOAuthBearerTokenOptions,
} from './oauth-resource'
export type {
  BetterAuthUserProjectionSource,
  CreateUserProjectionTriggersOptions,
} from './user-projection'
