import { normalizeConvexAuthConfig, type NormalizedConvexAuthConfig } from './auth-config'
import { resolveConvexSiteUrl } from './convex-config'
import type { LogLevel } from './logger'
import { normalizeConvexDeploymentUrl, normalizeConvexSiteUrl } from './site-url'

/**
 * The internal, fully materialized per-app runtime config. `auth` is false for
 * the no-auth build or the one normalized auth policy selected at build time.
 */
export interface NormalizedConvexRuntimeConfig {
  url?: string
  siteUrl?: string
  auth: NormalizedConvexAuthConfig
  logging: LogLevel | false
}

/**
 * The minimal public connection projection returned by `useConvexConfig()`.
 */
export interface ConvexRuntimeConfig {
  readonly url: string | undefined
  readonly siteUrl: string | undefined
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : null
}

export function normalizeConvexRuntimeConfig(input: unknown): NormalizedConvexRuntimeConfig {
  const raw = asRecord(input)

  // URL/siteUrl are resolved from runtimeConfig only. module.ts reads env at build
  // time; Nuxt's native `NUXT_PUBLIC_*` runtime override supplies deploy-time
  // values. Re-reading process.env here would be server-only and silently diverge.
  const url =
    typeof raw?.url === 'string' && raw.url.length > 0
      ? normalizeConvexDeploymentUrl(raw.url)
      : undefined
  const explicitSiteUrl =
    typeof raw?.siteUrl === 'string' && raw.siteUrl.length > 0 ? raw.siteUrl : undefined
  const candidateSiteUrl = resolveConvexSiteUrl({
    url,
    siteUrl: explicitSiteUrl,
  }).siteUrl
  const resolvedSiteUrl = candidateSiteUrl ? normalizeConvexSiteUrl(candidateSiteUrl) : undefined

  return {
    url,
    siteUrl: resolvedSiteUrl || undefined,
    auth: normalizeConvexAuthConfig(raw?.auth),
    logging:
      raw?.logging === false || typeof raw?.logging === 'string'
        ? (raw.logging as LogLevel | false)
        : false,
  }
}

/** Project the internal config onto the read-only public {@link ConvexRuntimeConfig}. */
export function toPublicConvexRuntimeConfig(
  internal: NormalizedConvexRuntimeConfig,
): ConvexRuntimeConfig {
  return {
    url: internal.url,
    siteUrl: internal.siteUrl,
  }
}
