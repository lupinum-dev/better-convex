import { isRef } from 'vue'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Unwrap refs only inside the container types supported by reactive Convex
 * arguments. Convex values such as ArrayBuffer and bigint remain opaque.
 */
export function normalizeConvexReactiveArgs<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()

  const normalize = (input: unknown): unknown => {
    const unwrapped = isRef(input) ? input.value : input
    if (!unwrapped || typeof unwrapped !== 'object') return unwrapped

    const objectValue = unwrapped as object
    const existing = seen.get(objectValue)
    if (existing) return existing

    if (Array.isArray(unwrapped)) {
      const draft = Array.from({ length: unwrapped.length })
      seen.set(objectValue, draft)

      let changed = false
      for (let index = 0; index < unwrapped.length; index += 1) {
        const next = normalize(unwrapped[index])
        draft[index] = next
        if (next !== unwrapped[index]) changed = true
      }

      const result = changed ? draft : unwrapped
      seen.set(objectValue, result)
      return result
    }

    if (!isPlainRecord(unwrapped)) return unwrapped

    const draft: Record<string, unknown> = {}
    seen.set(objectValue, draft)

    let changed = false
    for (const [key, entry] of Object.entries(unwrapped)) {
      const next = normalize(entry)
      draft[key] = next
      if (next !== entry) changed = true
    }

    const result = changed ? draft : unwrapped
    seen.set(objectValue, result)
    return result
  }

  return normalize(value) as T
}
