import type { H3Event } from 'h3'

import {
  normalizeConvexRuntimeConfig,
  type NormalizedConvexRuntimeConfig,
} from '../../utils/runtime-config-normalize'

/**
 * The request's normalized Convex config. The runtime-config Nitro plugin
 * materializes `event.context.nitro.runtimeConfig` before handlers run, so the
 * public server helpers stay free of Nuxt imports.
 */
export function readEventConvexConfig(event: H3Event): NormalizedConvexRuntimeConfig {
  const context = event.context as {
    nitro?: { runtimeConfig?: { public?: { convex?: unknown } } }
  }
  return normalizeConvexRuntimeConfig(context.nitro?.runtimeConfig?.public?.convex)
}

/** The incoming `Cookie` header, from either the web or the Node request. */
export function readEventCookieHeader(event: H3Event): string | null {
  const directHeader = (event as { headers?: { get?: (name: string) => string | null } }).headers
  if (directHeader?.get) {
    return directHeader.get('cookie')
  }
  const nodeHeaders = (
    event as {
      node?: {
        req?: { headers?: Record<string, string | string[] | undefined> }
      }
    }
  ).node?.req?.headers
  const raw = nodeHeaders?.cookie
  if (Array.isArray(raw)) return raw.join('; ')
  return typeof raw === 'string' ? raw : null
}
