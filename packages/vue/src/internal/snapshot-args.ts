/**
 * Copy plain objects and arrays at call time, so later edits to the caller's
 * (often reactive) object cannot reach the client or a replayed optimistic
 * update. Values are read through Vue proxies, exactly as Convex would read
 * them, so refs inside a `reactive()` object arrive unwrapped. Other values
 * (refs in plain objects, Dates, buffers, class instances) keep their identity.
 */
export function snapshotArgs<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(snapshotArgs) as T
  if (!isPlainObject(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    // defineProperty keeps a `__proto__` key as data instead of a prototype.
    Object.defineProperty(result, key, {
      value: snapshotArgs(entry),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return result as T
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
