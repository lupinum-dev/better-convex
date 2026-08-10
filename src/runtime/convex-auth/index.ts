export { defineAuthAdapterFunctions } from './adapter/define-functions'
export { createAuthComponent } from './create-auth-component'
export { requireAuthOrigin } from './origin'
export { convexAuth } from './plugin'
export { getConvexAuthProvider } from './provider'
export { createBetterAuthMcpAccessVerifier, verifyOAuthBearerToken } from './oauth-resource'
export { createUserProjectionTriggers } from './user-projection'

export type { AuthCtx } from './context'
export type { AuthComponentTriggers, AuthFunctions, CreateAuth } from './types'
export type {
  BetterAuthMcpAccessVerifierOptions,
  VerifyOAuthBearerTokenOptions,
} from './oauth-resource'
export type {
  BetterAuthUserProjectionSource,
  CreateUserProjectionTriggersOptions,
} from './user-projection'
