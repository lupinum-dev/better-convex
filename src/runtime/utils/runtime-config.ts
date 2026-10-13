import { useRuntimeConfig } from '#imports'

import {
  normalizeConvexRuntimeConfig,
  type NormalizedConvexRuntimeConfig,
} from './runtime-config-normalize'

export * from './runtime-config-normalize'

/**
 * Read and normalize the current Nuxt application's Convex config: the public
 * part everywhere, plus the server-only part (trusted client IP header) where
 * Nuxt provides it.
 */
export function getConvexRuntimeConfig(): NormalizedConvexRuntimeConfig {
  const config = useRuntimeConfig()
  return normalizeConvexRuntimeConfig(
    config.public.convex,
    import.meta.server ? config.convex : undefined,
  )
}
