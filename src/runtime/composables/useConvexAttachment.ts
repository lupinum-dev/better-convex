import type { BetterConvexAttachment } from '@lupinum/better-convex-vue/embedded'

import { useNuxtApp } from '#app'

import { ConvexCallError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'

function attachmentUnavailable(message: string): ConvexCallError {
  return new ConvexCallError({ kind: 'unknown', code: 'CLIENT_UNAVAILABLE', message })
}

/**
 * Read the frozen, token-free Vue runtime attachment owned by this Nuxt app.
 *
 * Pass this object to a separately bundled Vue application using
 * `createBetterConvex({ attachment })`. It intentionally excludes the
 * broader internal Nuxt runtime context and every credential/provider control.
 *
 * Throws a `ConvexCallError` with code `CLIENT_UNAVAILABLE` on the server or
 * when no Convex URL is configured.
 */
export function useConvexAttachment(): BetterConvexAttachment {
  if (import.meta.server) {
    throw attachmentUnavailable(
      '[useConvexAttachment] Runtime attachment is available only in the browser.',
    )
  }
  const attachment = readConvexRuntimeContext(useNuxtApp())?.attachment
  if (!attachment) {
    throw attachmentUnavailable(
      '[useConvexAttachment] Convex browser runtime is unavailable. Configure a Convex URL before attaching an embedded application.',
    )
  }
  return attachment
}
