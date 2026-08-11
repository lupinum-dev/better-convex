import { isRef } from 'vue'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Deeply unwrap Vue refs contained inside plain objects/arrays.
 * Non-plain objects (Date, Map, class instances, etc.) are treated as opaque.
 */
export function deepUnref<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()

  const unwrap = (input: unknown): unknown => {
    const unwrapped = isRef(input) ? input.value : input
    if (!unwrapped || typeof unwrapped !== 'object') {
      return unwrapped
    }

    const objectValue = unwrapped as object
    const existing = seen.get(objectValue)
    if (existing) {
      return existing
    }

    if (Array.isArray(unwrapped)) {
      const arrayInput = unwrapped as unknown[]
      const draft = Array.from({ length: arrayInput.length })
      seen.set(objectValue, draft)

      let changed = false
      for (let i = 0; i < arrayInput.length; i++) {
        const next = unwrap(arrayInput[i])
        draft[i] = next
        if (next !== arrayInput[i]) {
          changed = true
        }
      }

      const result = changed ? draft : arrayInput
      seen.set(objectValue, result)
      return result
    }

    if (isPlainObject(unwrapped)) {
      const objectInput = unwrapped as Record<string, unknown>
      const draft: Record<string, unknown> = {}
      seen.set(objectValue, draft)

      let changed = false
      for (const [key, entry] of Object.entries(objectInput)) {
        const next = unwrap(entry)
        draft[key] = next
        if (next !== entry) {
          changed = true
        }
      }

      const result = changed ? draft : objectInput
      seen.set(objectValue, result)
      return result
    }

    return unwrapped
  }

  return unwrap(value) as T
}
