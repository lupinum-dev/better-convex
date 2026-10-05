import {
  useConvexOperation as useVueConvexOperation,
  type ConvexOperationWork,
  type UseConvexOperationReturn,
} from '@lupinum/better-convex-vue/experimental'

export type {
  ConvexOperationWork,
  UseConvexOperationReturn,
} from '@lupinum/better-convex-vue/experimental'

export type { ConvexOperation, ConvexOperationUploadOptions } from '@lupinum/better-convex-vue'

/**
 * Run several Convex steps as one operation that belongs to one signed-in
 * identity, with `run`, `data`, `status`, `pending`, `error`, and `reset`.
 * Nuxt experimental entry for the Vue composable; it adds nothing.
 *
 * Each `run()` starts an operation for the identity that is current then.
 * Each step checks it immediately before sending: after an identity change a
 * step rejects with `IDENTITY_CHANGED` and `outcome: 'not-sent'` (nothing was
 * sent) or `outcome: 'unknown'` (it was in flight and may have committed), and
 * the state returns to `idle`. During server rendering, steps reject with
 * `CLIENT_UNAVAILABLE`.
 *
 * ```ts
 * import { useConvexOperation } from '@lupinum/better-convex-nuxt/experimental'
 *
 * const { run: publish, pending, error } = useConvexOperation(
 *   async (op, draftId: Id<'drafts'>) => {
 *     const draft = await op.query(api.drafts.get, { draftId })
 *     return op.mutation(api.posts.publish, { draftId, title: draft.title })
 *   },
 * )
 * ```
 */
export function useConvexOperation<Args extends unknown[], Result>(
  work: ConvexOperationWork<Args, Result>,
): UseConvexOperationReturn<Args, Result> {
  return useVueConvexOperation(work)
}
