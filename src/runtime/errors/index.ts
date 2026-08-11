/**
 * Nuxt compatibility entry for the framework-neutral Better Convex error model.
 * The implementation lives in `better-convex-vue`; this package adds no second
 * normalizer or error class.
 */
export {
  ConvexCallError,
  isSerializedConvexCallError,
  normalizeConvexError,
} from 'better-convex-vue/errors'
export type {
  ConvexCallErrorInput,
  ConvexCallErrorKind,
  SerializedConvexCallError,
} from 'better-convex-vue/errors'
