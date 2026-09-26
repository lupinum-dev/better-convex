import { CONVEX_MODULE_DEFAULTS } from './config-defaults'

/** The serializable `ConvexClient` options the module passes to the browser client. */
export interface ConvexClientConfig {
  readonly verbose?: boolean
  readonly skipConvexDeploymentUrlCheck?: boolean
  readonly unsavedChangesWarning?: boolean
}

/** Bounds for Convex HTTP calls made during SSR and by `serverConvex`. */
export interface ConvexServerConfig {
  readonly maxResponseBytes: number
  readonly queryTimeoutMs: number
}

const CLIENT_CONFIG_KEYS = ['verbose', 'skipConvexDeploymentUrlCheck', 'unsavedChangesWarning']
const SERVER_CONFIG_KEYS = ['maxResponseBytes', 'queryTimeoutMs']
/** `setTimeout` clamps larger delays to 1 ms, so they are rejected instead. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

function readOptionObject(input: unknown, label: string): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`[better-convex-nuxt] ${label} must be an object`)
  }
  return input as Record<string, unknown>
}

function assertKnownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`[better-convex-nuxt] ${label}.${key} is not a supported option`)
    }
  }
}

/** Validate `convex.client`; only explicitly set options are kept. */
export function normalizeConvexClientConfig(input: unknown): ConvexClientConfig {
  const raw = readOptionObject(input, 'client')
  assertKnownKeys(raw, CLIENT_CONFIG_KEYS, 'client')
  const config: Record<string, boolean> = {}
  for (const key of CLIENT_CONFIG_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') {
      throw new TypeError(`[better-convex-nuxt] client.${key} must be a boolean`)
    }
    config[key] = value
  }
  return Object.freeze(config) as ConvexClientConfig
}

function readPositiveInteger(value: unknown, fallback: number, label: string, maximum?: number) {
  if (value === undefined) return fallback
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new TypeError(
      `[better-convex-nuxt] ${label} must be a positive integer${maximum === undefined ? '' : ` no greater than ${maximum}`}`,
    )
  }
  return value
}

/** Validate `convex.server`, filling the documented defaults. */
export function normalizeConvexServerConfig(input: unknown): ConvexServerConfig {
  const raw = readOptionObject(input, 'server')
  assertKnownKeys(raw, SERVER_CONFIG_KEYS, 'server')
  return Object.freeze({
    maxResponseBytes: readPositiveInteger(
      raw.maxResponseBytes,
      CONVEX_MODULE_DEFAULTS.server.maxResponseBytes,
      'server.maxResponseBytes',
    ),
    queryTimeoutMs: readPositiveInteger(
      raw.queryTimeoutMs,
      CONVEX_MODULE_DEFAULTS.server.queryTimeoutMs,
      'server.queryTimeoutMs',
      MAX_TIMER_DELAY_MS,
    ),
  })
}
