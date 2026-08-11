const REDACTED = '[Redacted]'
const UNREADABLE = '[Unreadable]'
const ACCESSOR = '[Accessor]'
const CIRCULAR = '[Circular]'
const TRUNCATED = '[Truncated]'

const SECRET_KEY =
  /token|jwt|bearer|cookie|authorization|secret|password|passphrase|session|credential|(?:api|private|access)[_-]?key/i
const OMITTED_KEY = /^(?:stack|request|response|headers)$/i
const MAX_DEPTH = 4
const MAX_ITEMS = 50
const MAX_STRING_LENGTH = 512

function sanitizeString(value: string): string {
  let escaped = ''
  const bounded =
    value.length > MAX_STRING_LENGTH * 2 ? value.slice(0, MAX_STRING_LENGTH * 2) : value
  for (const character of bounded) {
    const codeUnit = character.charCodeAt(0)
    escaped +=
      codeUnit <= 31 || (codeUnit >= 127 && codeUnit <= 159)
        ? `\\u${codeUnit.toString(16).toUpperCase().padStart(4, '0')}`
        : character
  }
  return escaped.length <= MAX_STRING_LENGTH
    ? escaped
    : `${escaped.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`
}

/**
 * Convert an arbitrary value into bounded diagnostic data without invoking
 * getters. Every property/proxy failure is isolated so logging and DevTools
 * can never break application behavior.
 */
export function sanitizeDiagnosticValue(value: unknown): unknown {
  const seen = new WeakSet<object>()

  function visit(current: unknown, depth: number): unknown {
    if (current === null || current === undefined) return current
    if (typeof current === 'string') return sanitizeString(current)
    if (typeof current === 'number' || typeof current === 'boolean') return current
    if (typeof current === 'bigint') return `${current.toString()}n`
    if (typeof current === 'symbol')
      return sanitizeString(current.description ? `Symbol(${current.description})` : 'Symbol()')
    if (typeof current === 'function') return '[Function]'
    if (typeof current !== 'object') return String(current)
    if (depth >= MAX_DEPTH) return TRUNCATED
    if (seen.has(current)) return CIRCULAR
    seen.add(current)

    let keys: PropertyKey[]
    try {
      keys = Reflect.ownKeys(current)
    } catch {
      return UNREADABLE
    }

    let isArray: boolean
    try {
      isArray = Array.isArray(current)
    } catch {
      return UNREADABLE
    }
    const output: Record<string, unknown> | unknown[] = isArray ? [] : {}
    let emitted = 0
    for (const key of keys) {
      if (emitted >= MAX_ITEMS) {
        if (!Array.isArray(output)) output[TRUNCATED] = true
        break
      }
      const label = sanitizeString(typeof key === 'symbol' ? key.toString() : String(key))
      if (isArray && label === 'length') continue
      if (OMITTED_KEY.test(label)) continue
      emitted += 1

      if (SECRET_KEY.test(label)) {
        Object.defineProperty(output, label, {
          value: REDACTED,
          enumerable: true,
          configurable: true,
        })
        continue
      }

      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key)
      } catch {
        descriptor = undefined
      }
      const sanitized =
        descriptor && 'value' in descriptor
          ? visit(descriptor.value, depth + 1)
          : descriptor
            ? ACCESSOR
            : UNREADABLE
      Object.defineProperty(output, label, {
        value: sanitized,
        enumerable: true,
        configurable: true,
      })
    }

    return output
  }

  return visit(value, 0)
}
