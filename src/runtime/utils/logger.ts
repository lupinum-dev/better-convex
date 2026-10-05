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
  phase: string // e.g. 'init', 'session-check', 'ssr.jwt.exchange'
  outcome: 'success' | 'error' | 'miss'
  details?: Record<string, unknown> // stable codes, durations, flags
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

interface PreparedAuthEvent {
  phase: string
  icon: string
  tone: 'success' | 'error' | 'warning'
  details?: Record<string, unknown>
  hasError: boolean
}

interface PreparedUploadEvent {
  name: string
  icon: string
  success: boolean
  details: string[]
  hasError: boolean
}

interface LogOutput {
  auth(event: PreparedAuthEvent): void
  upload(event: PreparedUploadEvent): void
  debug(message: string): void
  time(label: string, elapsed: number): void
}

function createServerOutput(): LogOutput {
  const prefix = `${ANSI.cyan}[convex]${ANSI.reset}`
  const colors = { success: ANSI.green, error: ANSI.red, warning: ANSI.yellow }
  return {
    auth(event) {
      const icon = `${colors[event.tone]}${event.icon}${ANSI.reset}`
      let msg = `${prefix} ${icon} Auth:${event.phase}`
      if (event.details) msg += `  ${ANSI.dim}${formatDetails(event.details)}${ANSI.reset}`
      if (event.hasError) console.error(msg, '[Omitted]')
      else console.log(msg)
    },
    upload(event) {
      const color = event.success ? ANSI.green : ANSI.red
      let msg = `${prefix} ${color}${event.icon}${ANSI.reset} ${event.name}`
      msg += `  ${color}${event.success ? 'success' : 'error'}${ANSI.reset}`
      for (const detail of event.details) msg += ` ${ANSI.dim}${detail}${ANSI.reset}`
      if (!event.success && event.hasError) msg += ` ${ANSI.red}[Omitted]${ANSI.reset}`
      console.log(msg)
    },
    debug(message) {
      console.log(`${prefix} ${ANSI.dim}[debug]${ANSI.reset} ${message}`)
    },
    time(label, elapsed) {
      console.log(`${prefix} ${ANSI.dim}[time]${ANSI.reset} ${label}: ${elapsed}ms`)
    },
  }
}

function createBrowserOutput(): LogOutput {
  return {
    auth(event) {
      const label = `%cConvex%c Auth | %c${event.icon} ${event.phase}`
      const styles = [CSS.badge, '', CSS[event.tone]]
      if ((event.details && Object.keys(event.details).length > 0) || event.hasError) {
        console.groupCollapsed(label, ...styles)
        if (event.details) console.log(event.details)
        if (event.hasError) console.error('[Omitted]')
        console.groupEnd()
      } else console.log(label, ...styles)
    },
    upload(event) {
      let label = `%cConvex%c ${event.icon} %c${event.name}`
      const styles = [CSS.badge, '', CSS.name]
      for (const detail of event.details) {
        label += `%c ${detail}`
        styles.push(CSS.dim)
      }
      if (!event.success) {
        label += `%c Failed`
        styles.push(CSS.error)
      }
      if (event.hasError) {
        console.groupCollapsed(label, ...styles)
        console.error('Error:', '[Omitted]')
        console.groupEnd()
      } else console.log(label, ...styles)
    },
    debug(message) {
      console.log(`%cConvex%c [debug] ${message}`, CSS.badge, CSS.dim)
    },
    time(label, elapsed) {
      console.log(`%cConvex%c [time] ${label}: ${elapsed}ms`, CSS.badge, CSS.dim)
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
  const sink = !isBrowserRuntime() ? createServerOutput() : createBrowserOutput()

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
    auth(event) {
      const safe = sanitizeEvent(event)
      const tone = safe.outcome === 'miss' ? 'warning' : safe.outcome
      sink.auth({
        phase: safe.phase,
        icon: ICONS[tone],
        tone,
        details: safe.details,
        hasError: Boolean(safe.error),
      })
    },
    upload(event) {
      const safe = sanitizeEvent(event)
      const success = safe.event === 'success'
      const details: string[] = []
      if (success) {
        if (safe.filename) details.push(safe.filename)
        if (safe.size !== undefined) details.push(`(${formatBytes(safe.size)})`)
        if (safe.duration !== undefined) details.push(formatDuration(safe.duration))
      }
      sink.upload({
        name: safe.name,
        icon: success ? ICONS.upload : ICONS.error,
        success,
        details,
        hasError: Boolean(safe.error),
      })
    },
    debug(message, data) {
      if (level !== 'debug') return
      // Generic payloads have no reviewed schema. Semantic details carry structured diagnostics.
      void data
      sink.debug(String(sanitizeDiagnosticValue(message)))
    },
    time(label) {
      if (level !== 'debug') return () => {}
      const safeLabel = String(sanitizeDiagnosticValue(label))
      const start = performance.now()
      return () => sink.time(safeLabel, Math.round(performance.now() - start))
    },
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
