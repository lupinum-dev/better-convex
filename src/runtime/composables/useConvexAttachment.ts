import type { BetterConvexAttachment } from 'better-convex-vue/embedded'

import { useNuxtApp } from '#app'

import { readConvexRuntimeContext } from '../runtime-context'

/**
 * Read the frozen, token-free Vue runtime attachment owned by this Nuxt app.
 *
 * Pass this object to a separately bundled Vue application using
 * `createBetterConvex({ attachment })`. It intentionally excludes the
 * broader internal Nuxt runtime context and every credential/provider control.
 */
export function useConvexAttachment(): BetterConvexAttachment {
  if (import.meta.server) {
    throw new Error('[useConvexAttachment] Runtime attachment is available only in the browser.')
  }
  const attachment = readConvexRuntimeContext(useNuxtApp())?.attachment
  if (!attachment) {
    throw new Error(
      '[useConvexAttachment] Convex browser runtime is unavailable. Configure a Convex URL before attaching an embedded application.',
    )
  }
  return attachment
}
