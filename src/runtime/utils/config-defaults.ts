import type { LogLevel } from './logger'

/**
 * Single source of truth for better-convex-nuxt config default literals.
 *
 * `module.ts` (build-time `defaults:` block + the defu merge into runtimeConfig)
 * and the auth proxy body limits consume these. Grep the file name if you need
 * to change a default.
 *
 * Internal only: not part of the public auto-import surface, not exported from
 * the module entrypoint.
 */

// --- Named literals (each config default appears exactly once) ---------------

const DEFAULT_AUTH_PROXY_BODY_LIMIT_BYTES = 1_048_576

// --- Frozen defaults object --------------------------------------------------

export const CONVEX_MODULE_DEFAULTS = Object.freeze({
  logging: false as LogLevel | false,
  authProxy: Object.freeze({
    maxRequestBodyBytes: DEFAULT_AUTH_PROXY_BODY_LIMIT_BYTES,
    maxResponseBodyBytes: DEFAULT_AUTH_PROXY_BODY_LIMIT_BYTES,
  }),
})
