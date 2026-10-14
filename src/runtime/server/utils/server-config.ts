import { useRuntimeConfig } from 'nuxt/server'

import {
  normalizeConvexRuntimeConfig,
  type NormalizedConvexRuntimeConfig,
} from '../../utils/runtime-config-normalize'

/**
 * The normalized Convex config of the running Nitro server: the public part
 * plus the server-only part (trusted client IP header).
 *
 * Nitro code only. Nuxt's import protection fails the app build when a file
 * that `plugin.server.ts` imports reaches `nuxt/server`, so the SSR plugin
 * passes the config it reads with `getConvexRuntimeConfig()` instead.
 */
export function readServerConvexConfig(): NormalizedConvexRuntimeConfig {
  const config = useRuntimeConfig()
  return normalizeConvexRuntimeConfig(config.public.convex, config.convex)
}
