export interface QueryLifecycleOptions {
  readonly immediate?: boolean
  readonly lazy?: boolean
}

export interface ResolvedQueryLifecycleOptions {
  readonly immediate: boolean
  readonly lazy: boolean
}

/** Resolve the lifecycle pair shared by query, multi-query, and pagination. */
export function resolveQueryLifecycleOptions(
  options: QueryLifecycleOptions | undefined,
): ResolvedQueryLifecycleOptions {
  const immediate = options?.immediate ?? true
  const lazy = options?.lazy ?? false
  if (lazy && !immediate) {
    throw new Error('[better-convex-nuxt] lazy: true cannot be combined with immediate: false')
  }
  return { immediate, lazy }
}
