import type { ConvexAuthMode } from '@lupinum/better-convex-vue'
import {
  setupBetterConvexTest as setupVueTest,
  type BetterConvexTestRuntime as VueTestRuntime,
} from '@lupinum/better-convex-vue/test'

import { ConvexCallError } from '../errors'
import type { ConvexUser } from '../utils/types'
import {
  createTestAuthState,
  DEFAULT_TEST_USER,
  type BetterConvexTestAuth,
  type BetterConvexTestAuthPreset,
} from './auth'

export { invalidCursorError } from '@lupinum/better-convex-vue/test'
export type {
  BetterConvexTestOperationControl,
  BetterConvexTestPaginatedQueryControl,
  BetterConvexTestQueryCall,
  BetterConvexTestQueryControl,
  BetterConvexTestRequest,
  BetterConvexTestStorageControl,
  BetterConvexTestStorageRequest,
  BetterConvexTestUploadCall,
  BetterConvexTestUploadControl,
  BetterConvexTestUploadOptions,
} from '@lupinum/better-convex-vue/test'
export type {
  BetterConvexTestAuth,
  BetterConvexTestAuthPreset,
  BetterConvexTestAuthResult,
} from './auth'

export interface BetterConvexTestOptions {
  /** The identity the test starts with. @default 'authenticated' */
  readonly auth?: BetterConvexTestAuthPreset | ConvexUser
  /** Mirrors `convex.auth.defaultQueryAuth` in `nuxt.config`. */
  readonly defaultQueryAuth?: ConvexAuthMode
}

/**
 * The Vue test runtime plus a `useConvexAuth()` double. Pass `plugin` to
 * `mountSuspended` so the real Nuxt composables run against the in-memory
 * transport, and bind `auth` to `useConvexAuth` with `mockNuxtImport`.
 */
export interface BetterConvexTestRuntime extends Omit<VueTestRuntime, 'auth'> {
  readonly auth: BetterConvexTestAuth
}

const TEST_AUTH_FAILURE = () =>
  new ConvexCallError({ kind: 'authentication', message: 'Test authentication failed' })

/**
 * Create a Better Convex runtime for Nuxt component tests.
 *
 * The component runs the real composables and controllers; only the Convex
 * deployment is replaced. Answer queries, writes, and uploads by function
 * reference, and move the identity with `auth`.
 */
export function setupBetterConvexTest(
  options: BetterConvexTestOptions = {},
): BetterConvexTestRuntime {
  const preset = options.auth ?? 'authenticated'
  const user =
    typeof preset === 'object' ? preset : preset === 'authenticated' ? DEFAULT_TEST_USER : null
  const runtime = setupVueTest({
    auth: user
      ? { subject: user.id }
      : (preset as Exclude<BetterConvexTestAuthPreset, 'authenticated'>),
    defaultQueryAuth: options.defaultQueryAuth,
  })
  const auth = createTestAuthState(
    runtime.auth,
    user,
    preset === 'error' ? TEST_AUTH_FAILURE() : undefined,
  )
  return Object.freeze({ ...runtime, auth })
}
