// Experimental APIs: not covered by semver; the shape may change in a minor release.
export { useConvexOperation } from '../composables/useConvexOperation'
export type {
  UseConvexOperationReturn,
  ConvexOperationWork,
} from '../composables/useConvexOperation'
export {
  insertAtTop,
  optimisticallyUpdateValueInPaginatedQuery,
} from '@lupinum/better-convex-vue/experimental'
