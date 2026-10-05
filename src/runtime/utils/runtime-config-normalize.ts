import { normalizeConvexAuthConfig, type NormalizedConvexAuthConfig } from './auth-config'
import { resolveConvexSiteUrl } from './convex-config'
import type { LogLevel } from './logger'
import { normalizeConvexDeploymentUrl, normalizeConvexSiteUrl } from './site-url'
import {
  normalizeConvexClientConfig,
  normalizeConvexServerConfig,
  type ConvexClientConfig,
  type ConvexServerConfig,
} from './transport-config'

/**
 * The internal, fully materialized per-app runtime config. `auth` is false for
 * the no-auth build or the one normalized auth policy selected at build time.
 */
export interface NormalizedConvexRuntimeConfig {
  url?: string
  siteUrl?: string
  auth: NormalizedConvexAuthConfig
  logging: LogLevel | false
  /** Options for the browser `ConvexClient`. */
  client: ConvexClientConfig
  /** Bounds for Convex HTTP calls made during SSR and by `serverConvex`. */
  server: ConvexServerConfig
  experimental: { keepAlive?: { ms: number; max: number } }
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

/** Validate at module setup and at runtime, with retention off by default. */
export function normalizeConvexKeepAlive(input: unknown): { ms: number; max: number } | undefined {
  if (input === undefined) return undefined
  const raw = asRecord(input)
  const ms = raw?.ms
  const max = raw?.max
  if (
    typeof ms !== 'number' ||
    !Number.isSafeInteger(ms) ||
    ms <= 0 ||
    typeof max !== 'number' ||
    !Number.isSafeInteger(max) ||
    max <= 0
  ) {
    throw new TypeError(
      '[better-convex-nuxt] experimental.keepAlive.ms and experimental.keepAlive.max must be positive safe integers',
    )
  }
  return { ms, max }
}

// One normalization per runtime config object. Nuxt and Nitro hand out the same
// object for an app or request, so repeated reads during a render reuse it.
const normalized = new WeakMap<object, NormalizedConvexRuntimeConfig>()

export function normalizeConvexRuntimeConfig(input: unknown): NormalizedConvexRuntimeConfig {
  const raw = asRecord(input)
  const cached = raw && normalized.get(raw)
  if (cached) return cached
  const result = normalizeUncached(raw)
  if (raw) normalized.set(raw, result)
  return result
}

function normalizeUncached(raw: Record<string, unknown> | null): NormalizedConvexRuntimeConfig {
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
    client: normalizeConvexClientConfig(raw?.client),
    server: normalizeConvexServerConfig(raw?.server),
    experimental: { keepAlive: normalizeConvexKeepAlive(asRecord(raw?.experimental)?.keepAlive) },
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
