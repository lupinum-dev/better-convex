// Generated-registry template for the EMPTY definition, in a SEPARATE TypeScript
// program. Mirrors the exact shape the module's
// addTypeTemplate emits, but pointed at the empty definition, so
// InferRegisteredConvexAuthClient collapses to the base client here.
import type definition from './convex-auth.base'

declare module '@lupinum/better-convex-nuxt/better-auth/client' {
  interface ConvexAuthClientRegistry {
    definition: typeof definition
  }
}
