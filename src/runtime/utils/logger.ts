/**
 * Semantic logger for better-convex-nuxt
 *
 * Levels:
 * - false: No logs (production default)
 * - 'info': Auth and upload events
 * - 'debug': Auth/uploads plus timing and debug messages
 *
 * Output:
 * - Server: ANSI-styled single-line logs for easy grep/scanning
 * - Browser: CSS badges + collapsed groups for clean dev tools
 */

import { sanitizeDiagnosticValue } from './sanitize-diagnostic'

export type LogLevel = false | 'info' | 'debug'

// ============================================================================
// Event Types
// ============================================================================

export interface AuthEvent {
  phase: string // 'session-check', 'cache', 'exchange', 'hydrate', 'login', 'logout'
  outcome: 'success' | 'error' | 'skip' | 'miss'
  details?: Record<string, unknown> // user, duration, cache status, etc.
  error?: unknown
}

export interface UploadEvent {
  name: string // function name
  event: 'success' | 'error'
  filename?: string
  size?: number // bytes
  duration?: number
  error?: unknown
}

// ============================================================================
// Logger Interface
// ============================================================================

export interface Logger {
  // Semantic methods - primary API
  auth(event: AuthEvent): void
  upload(event: UploadEvent): void

  // Generic fallback for edge cases
  debug(message: string, data?: unknown): void

  // Timing helper
  time(label: string): () => void
}

// ============================================================================
// No-op Logger
// ============================================================================

const noopLogger: Logger = Object.freeze({
  auth: () => {},
  upload: () => {},
  debug: () => {},
  time: () => () => {},
})

// ============================================================================
// ANSI Colors (Server)
// ============================================================================

const ANSI = {
  reset: '\x1B[0m',
  dim: '\x1B[2m',
  cyan: '\x1B[36m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  red: '\x1B[31m',
}

// ============================================================================
// Icons
// ============================================================================

const ICONS = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  upload: '📤',
}

// ============================================================================
// CSS Badges (Browser)
// ============================================================================

const CSS = {
  badge:
    'background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
  success: 'color: #22c55e; font-weight: bold;',
  error: 'color: #ef4444; font-weight: bold;',
  warning: 'color: #f59e0b; font-weight: bold;',
  dim: 'color: #9ca3af;',
  name: 'color: #3b82f6; font-weight: bold;',
}

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDuration(ms: number): string {
  return `${ms}ms`
}

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
}

// ============================================================================
// Server Logger (ANSI)
// ============================================================================

function createServerLogger(level: 'info' | 'debug'): Logger {
  const isDebug = level === 'debug'
  const PREFIX = `${ANSI.cyan}[convex]${ANSI.reset}`

  return {
    auth(event: AuthEvent): void {
      const icon =
        event.outcome === 'success'
          ? `${ANSI.green}${ICONS.success}${ANSI.reset}`
          : event.outcome === 'error'
            ? `${ANSI.red}${ICONS.error}${ANSI.reset}`
            : `${ANSI.yellow}${ICONS.warning}${ANSI.reset}`

      let msg = `${PREFIX} ${icon} Auth:${event.phase}`

      if (event.details) {
        msg += `  ${ANSI.dim}${formatDetails(event.details)}${ANSI.reset}`
      }

      if (event.error) {
        console.error(msg, '[Omitted]')
      } else {
        console.log(msg)
      }
    },

    upload(event: UploadEvent): void {
      const icon =
        event.event === 'error'
          ? `${ANSI.red}${ICONS.error}${ANSI.reset}`
          : `${ANSI.green}${ICONS.upload}${ANSI.reset}`

      let msg = `${PREFIX} ${icon} ${event.name}`

      if (event.event === 'success') {
        msg += `  ${ANSI.green}success${ANSI.reset}`
        if (event.filename) {
          msg += ` ${ANSI.dim}${event.filename}${ANSI.reset}`
        }
        if (event.size !== undefined) {
          msg += ` ${ANSI.dim}(${formatBytes(event.size)})${ANSI.reset}`
        }
        if (event.duration !== undefined) {
          msg += ` ${ANSI.dim}${formatDuration(event.duration)}${ANSI.reset}`
        }
      } else {
        msg += `  ${ANSI.red}error${ANSI.reset}`
        if (event.error) msg += ` ${ANSI.red}[Omitted]${ANSI.reset}`
      }

      console.log(msg)
    },

    debug(message: string, data?: unknown): void {
      if (!isDebug) return
      // Generic debug payloads have no reviewed schema. Keep the message only;
      // structured diagnostics belong in a semantic event's safe details.
      void data
      console.log(`${PREFIX} ${ANSI.dim}[debug]${ANSI.reset} ${message}`)
    },

    time(label: string): () => void {
      if (!isDebug) return () => {}
      const start = performance.now()
      return () => {
        const elapsed = Math.round(performance.now() - start)
        console.log(`${PREFIX} ${ANSI.dim}[time]${ANSI.reset} ${label}: ${elapsed}ms`)
      }
    },
  }
}

// ============================================================================
// Browser Logger (CSS badges + collapsed groups)
// ============================================================================

function createBrowserLogger(level: 'info' | 'debug'): Logger {
  const isDebug = level === 'debug'

  return {
    auth(event: AuthEvent): void {
      const icon =
        event.outcome === 'success'
          ? ICONS.success
          : event.outcome === 'error'
            ? ICONS.error
            : ICONS.warning
      const iconStyle =
        event.outcome === 'success'
          ? CSS.success
          : event.outcome === 'error'
            ? CSS.error
            : CSS.warning

      const hasDetails = event.details && Object.keys(event.details).length > 0

      if (hasDetails || event.error) {
        console.groupCollapsed(
          `%cConvex%c Auth | %c${icon} ${event.phase}`,
          CSS.badge,
          '',
          iconStyle,
        )
        if (event.details) console.log(event.details)
        if (event.error) console.error('[Omitted]')
        console.groupEnd()
      } else {
        console.log(`%cConvex%c Auth | %c${icon} ${event.phase}`, CSS.badge, '', iconStyle)
      }
    },

    upload(event: UploadEvent): void {
      const icon = event.event === 'error' ? ICONS.error : ICONS.upload

      let label = `%cConvex%c ${icon} %c${event.name}`
      const styles = [CSS.badge, '', CSS.name]

      if (event.event === 'success') {
        if (event.filename) {
          label += `%c ${event.filename}`
          styles.push(CSS.dim)
        }
        if (event.size !== undefined) {
          label += `%c (${formatBytes(event.size)})`
          styles.push(CSS.dim)
        }
        if (event.duration !== undefined) {
          label += `%c ${formatDuration(event.duration)}`
          styles.push(CSS.dim)
        }
      } else {
        label += `%c Failed`
        styles.push(CSS.error)
      }

      if (event.error) {
        console.groupCollapsed(label, ...styles)
        console.error('Error:', '[Omitted]')
        console.groupEnd()
      } else {
        console.log(label, ...styles)
      }
    },

    debug(message: string, data?: unknown): void {
      if (!isDebug) return
      void data
      console.log(`%cConvex%c [debug] ${message}`, CSS.badge, CSS.dim)
    },

    time(label: string): () => void {
      if (!isDebug) return () => {}
      const start = performance.now()
      return () => {
        const elapsed = Math.round(performance.now() - start)
        console.log(`%cConvex%c [time] ${label}: ${elapsed}ms`, CSS.badge, CSS.dim)
      }
    },
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a logger with the specified level.
 * Automatically selects ANSI (server) or CSS (browser) styling.
 */
export function createLogger(level: LogLevel): Logger {
  if (!level) return noopLogger

  // Use ANSI on server, CSS in browser
  const sink = !isBrowserRuntime() ? createServerLogger(level) : createBrowserLogger(level)

  const sanitizeEvent = <
    T extends {
      phase?: string
      name?: string
      filename?: string
      details?: unknown
      error?: unknown
    },
  >(
    event: T,
  ): T =>
    ({
      ...event,
      ...(event.phase === undefined ? {} : { phase: String(sanitizeDiagnosticValue(event.phase)) }),
      ...(event.name === undefined ? {} : { name: String(sanitizeDiagnosticValue(event.name)) }),
      ...(event.filename === undefined
        ? {}
        : { filename: String(sanitizeDiagnosticValue(event.filename)) }),
      ...(event.details === undefined ? {} : { details: sanitizeDiagnosticValue(event.details) }),
      // Error objects/messages often contain transport data and credentials.
      // Callers must put a stable, reviewed code in `details` instead.
      ...(event.error === undefined ? {} : { error: '[Omitted]' }),
    }) as T

  const safeLogger: Logger = {
    auth: (event) => sink.auth(sanitizeEvent(event)),
    upload: (event) => sink.upload(sanitizeEvent(event)),
    debug: (message, data) => sink.debug(String(sanitizeDiagnosticValue(message)), data),
    time: (label) => sink.time(String(sanitizeDiagnosticValue(label))),
  }
  return Object.freeze(safeLogger)
}

function isBrowserRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
  )
}

/**
 * Get log level from runtime config.
 */
export function getLogLevel(config: unknown): LogLevel {
  const logging = (
    config && typeof config === 'object' && 'logging' in config
      ? (config as { logging?: LogLevel }).logging
      : undefined
  ) as LogLevel | undefined
  return logging ?? false
}
