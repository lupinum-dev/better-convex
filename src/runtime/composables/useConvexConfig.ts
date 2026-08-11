import {
  getConvexRuntimeConfig,
  toPublicConvexRuntimeConfig,
  type ConvexRuntimeConfig,
} from '../utils/runtime-config'

export type { ConvexRuntimeConfig } from '../utils/runtime-config'

/**
 * Read the resolved Convex connection origins.
 *
 * @example
 * ```ts
 * const config = useConvexConfig()
 * console.log(config.url, config.siteUrl)
 * ```
 */
export function useConvexConfig(): ConvexRuntimeConfig {
  return toPublicConvexRuntimeConfig(getConvexRuntimeConfig())
}
