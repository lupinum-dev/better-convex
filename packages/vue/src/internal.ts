/**
 * NOT PUBLIC API.
 *
 * Typed integration seam for `@lupinum/better-convex-nuxt`, which ships in
 * lockstep with this package. Nothing here follows semver; applications must
 * import from `@lupinum/better-convex-vue` or its documented subpaths.
 */
export { useConvexQueryInternal } from './use-query'
export { useConvexPaginatedQueryInternal } from './use-paginated-query'
export { useConvexActionInternal, useConvexMutationInternal } from './use-callable'
export { useConvexFormInternal, type ConvexFormInternalOptions } from './use-form'
export {
  useConvexFileUploadInternal,
  type ConvexFileUploadInternalOptions,
} from './use-file-upload'
export { projectConvexConnectionState } from './use-connection-state'
export { refreshBetterConvexAuth, useBetterConvexIdentity } from './runtime-context'
export type { CallableControllerObserver } from './internal/callable-controller'
export { DISCONNECTED_CONNECTION_STATE } from './internal/connection-state'
export { isAuthenticatedIdentityKey, type ConvexIdentityKey } from './internal/identity-key'
export type { ClientIdentitySnapshot } from './internal/identity-port'
export {
  createConvexArgsState,
  type ConvexArgsInput,
  type ConvexArgsState,
} from './internal/query-args'
export {
  decideQueryExecution,
  decideQueryGate,
  queryIsolationTag,
  type QueryExecutionOutcome,
} from './internal/query-execution'
export { deriveQueryStatus } from './internal/query-status'
export { createSettlementWaiters } from './internal/settlement'
// Type plumbing the Nuxt wrappers share with Vue; not public API.
export type { OptimisticUpdateCandidate, SynchronousOptimisticUpdate } from './use-callable'
export type { UploadOptionsParameter } from './use-file-upload'
