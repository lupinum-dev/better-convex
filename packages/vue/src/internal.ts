/**
 * NOT PUBLIC API.
 *
 * Typed integration seam for `@lupinum/better-convex-nuxt`, which ships in
 * lockstep with this package. Nothing here follows semver; applications must
 * import from `@lupinum/better-convex-vue` or its documented subpaths.
 */
export {
  useConvexQueryInternal,
  type ConvexQueryHydrationSeed,
  type UseConvexQueryInternalInput,
} from './use-query'
export {
  useConvexPaginatedQueryInternal,
  type ConvexPaginatedQueryInternal,
  type ConvexPaginationBridge,
  type UseConvexPaginatedQueryInternalInput,
} from './use-paginated-query'
export {
  useConvexActionInternal,
  useConvexMutationInternal,
  type ConvexCallableInternalOptions,
} from './use-callable'
export { useConvexFormInternal, type ConvexFormInternalOptions } from './use-form'
export {
  useConvexFileUploadInternal,
  type ConvexFileUploadInternalOptions,
} from './use-file-upload'
export type { ConvexFileUploadObserver } from './internal/upload-controller'
export { projectConvexConnectionState } from './use-connection-state'
export { refreshBetterConvexAuth, useBetterConvexIdentity } from './runtime-context'
export type { CallableControllerObserver } from './internal/callable-controller'
export { DISCONNECTED_CONNECTION_STATE } from './internal/connection-state'
export { isAuthenticatedIdentityKey, type ConvexIdentityKey } from './internal/identity-key'
export type { ClientIdentitySnapshot } from './internal/identity-port'
export { createConvexArgsState, type ConvexArgsState } from './internal/query-args'
export {
  decideQueryExecution,
  decideQueryGate,
  queryIsolationTag,
  type QueryExecutionOutcome,
  type QueryGateDecision,
} from './internal/query-execution'
export { deriveQueryStatus, type QueryStatusInput } from './internal/query-status'
export { createSettlementWaiters, type SettlementWaiters } from './internal/settlement'
