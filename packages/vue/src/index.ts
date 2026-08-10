export { ConvexCallError } from './errors'
export type { CallResult, ConvexCallErrorKind } from './errors'
export { createBetterConvex } from './runtime-context'
export type { BetterConvexAuthAdapter, CreateBetterConvexOptions } from './runtime-context'
export type { BrowserAuthSnapshot as BetterConvexAuthSnapshot } from './internal/auth-adapter'
export type { ConvexClientHandle } from './internal/client-owner'
export type { ClientIdentitySnapshot as BetterConvexIdentitySnapshot } from './internal/identity-port'
export { useConvex } from './use-convex'
export { useConvexConnectionState } from './use-connection-state'
export { useConvexMutation, useConvexAction } from './use-callable'
export type {
  ConvexCallStatus,
  OptimisticUpdate,
  UseConvexCall,
  UseConvexMutationOptions,
} from './use-callable'
export { useConvexQuery } from './use-query'
export type { ConvexAuthMode, ConvexQueryArgs, UseConvexQueryOptions } from './use-query'
export { useConvexPaginatedQuery } from './use-paginated-query'
export type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseConvexPaginatedQueryOptions,
} from './use-paginated-query'
