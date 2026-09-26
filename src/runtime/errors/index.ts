/**
 * Nuxt entry for the framework-neutral Better Convex error model.
 * The implementation lives in `@lupinum/better-convex-vue`; this package adds no second
 * normalizer or error class.
 */
export {
  ConvexCallError,
  isConvexCallError,
  isSerializedConvexCallError,
  normalizeConvexError,
} from '@lupinum/better-convex-vue/errors'
export type {
  ConvexCallErrorCode,
  ConvexCallErrorInput,
  ConvexCallErrorKind,
  SerializedConvexCallError,
} from '@lupinum/better-convex-vue/errors'
