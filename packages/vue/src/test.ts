/**
 * Component-test runtime for `@lupinum/better-convex-vue`.
 *
 * Install `setupBetterConvexTest().plugin` instead of the application plugin.
 * Components then run the real composables, controllers, client owner, and
 * auth port against an in-memory Convex transport that the test answers by
 * function reference. Backend rules are not emulated; test them with
 * `convex-test`.
 */
export { setupBetterConvexTest } from './test/runtime'
export type {
  BetterConvexTestOperationControl,
  BetterConvexTestOptions,
  BetterConvexTestPaginatedQueryControl,
  BetterConvexTestQueryControl,
  BetterConvexTestRuntime,
  BetterConvexTestStorageControl,
  BetterConvexTestUploadCall,
  BetterConvexTestUploadControl,
  BetterConvexTestUploadOptions,
} from './test/runtime'
export type {
  BetterConvexTestAuthControl,
  BetterConvexTestAuthInput,
  BetterConvexTestAuthState,
} from './test/auth'
export type { BetterConvexTestStorageRequest } from './test/storage'
export { invalidCursorError } from './test/transport'
export type { BetterConvexTestQueryCall, BetterConvexTestRequest } from './test/transport'
