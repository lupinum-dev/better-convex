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
  BetterConvexOrganizationAuthInstance,
  BetterConvexSessionPolicy,
  CreateBetterConvexAuthOptions,
} from './create-better-convex-auth'
export type {
  BetterConvexOAuthOperator,
  BetterConvexPublicOAuthClientInput,
} from './oauth-operator'
export { getConvexAuthProvider } from './provider'
export { requireAuthOrigin } from './origin'
export { createBetterAuthMcpAccessVerifier } from './oauth-resource'
export { createUserProjectionTriggers } from './user-projection'

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
export type { BetterAuthMcpAccessVerifierOptions } from './oauth-resource'
export type {
  BetterAuthUserProjectionSource,
  CreateUserProjectionTriggersOptions,
} from './user-projection'

export type { OAuthLiveAccess } from './oauth-live-access'
