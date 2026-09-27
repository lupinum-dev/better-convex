function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Capture an upload's per-call `context` when `upload()` is called. Plain
 * objects and arrays, including `reactive()` proxies, are copied, so a later
 * change to component state cannot change what the upload completes against.
 * Other values (strings, IDs, class instances, refs) are kept as they are.
 */
export function snapshotUploadContext<Context>(context: Context): Context {
  const seen = new WeakMap<object, unknown>()
  const copy = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    const existing = seen.get(value)
    if (existing !== undefined) return existing
    if (Array.isArray(value)) {
      const draft: unknown[] = []
      seen.set(value, draft)
      for (const entry of value) draft.push(copy(entry))
      return draft
    }
    if (!isPlainObject(value)) return value
    const draft: Record<string, unknown> = {}
    seen.set(value, draft)
    // Read through the value itself: a `reactive()` proxy yields the unwrapped
    // values its type promises.
    for (const [key, entry] of Object.entries(value)) draft[key] = copy(entry)
    return draft
  }
  return copy(context) as Context
}
