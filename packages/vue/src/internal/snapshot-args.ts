import { isRef } from 'vue'

/**
 * Copy plain objects and arrays at call time, so later edits to the caller's
 * (often reactive) object cannot reach the client or a replayed optimistic
 * update. Refs are read as their current value, at any depth, as query
 * arguments are, so `mutate({ title })` with `title` a ref sends the string.
 * `ArrayBuffer` bytes are copied too. Other values (Dates, class instances)
 * keep their identity.
 */
export function snapshotArgs<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()
  const copy = (entry: unknown): unknown => {
    if (isRef(entry)) return copy(entry.value)
    if (entry === null || typeof entry !== 'object') return entry
    const prior = seen.get(entry)
    if (prior !== undefined) return prior
    if (entry instanceof ArrayBuffer) {
      const result = entry.slice(0)
      seen.set(entry, result)
      return result
    }
    if (Array.isArray(entry)) {
      const result: unknown[] = []
      seen.set(entry, result)
      entry.forEach((item, index) => {
        result[index] = copy(item)
      })
      result.length = entry.length
      return result
    }
    if (!isPlainObject(entry)) return entry

    const result: Record<string, unknown> = {}
    seen.set(entry, result)
    for (const [key, item] of Object.entries(entry)) {
      // defineProperty keeps a `__proto__` key as data instead of a prototype.
      Object.defineProperty(result, key, {
        value: copy(item),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return result
  }
  return copy(value) as T
}

// The same rule Convex uses for argument objects, including other realms.
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  return (
    proto === null ||
    proto === Object.prototype ||
    (proto as { constructor?: { name?: string } }).constructor?.name === 'Object'
  )
}
