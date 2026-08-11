import { useConvex as useVueConvex, type ConvexClientHandle } from 'better-convex-vue'

export type { ConvexClientHandle } from 'better-convex-vue'

/** Access the Vue-owned stable, replacement-safe Convex client handle. */
export function useConvex(): ConvexClientHandle {
  if (import.meta.server) {
    throw new Error(
      '[useConvex] Convex client handle is unavailable. This composable is client-only and requires a configured Convex URL.',
    )
  }
  return useVueConvex()
}
