/**
 * Nuxt entry for the Vue file-upload lifecycle; it adds only the module logger.
 *
 * Inspired by nuxt-convex by @onmax (https://github.com/onmax/nuxt-convex)
 */

import type {
  UploadUrlMutation,
  UseConvexFileUploadOptions,
  UseConvexFileUploadReturn,
} from '@lupinum/better-convex-vue'
import {
  useConvexFileUploadInternal,
  type ConvexFileUploadInternalOptions,
} from '@lupinum/better-convex-vue/internal'
import type { FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createLogger } from '../utils/logger'
import { getConvexRuntimeConfig } from '../utils/runtime-config'

export type {
  ConvexFileUploadResult,
  UploadComplete,
  UploadCompleteContext,
  UploadProgressInfo,
  UploadUrlMutation,
  UseConvexFileUploadOptions,
  UseConvexFileUploadReturn,
} from '@lupinum/better-convex-vue'

type UploadOptionsParameter<Prepared, Completed, Context> = [Prepared] extends [string]
  ? [options?: UseConvexFileUploadOptions<Prepared, Completed, Context>]
  : [options: UseConvexFileUploadOptions<Prepared, Completed, Context>]

/**
 * Upload files to Convex storage with byte progress, as one identity-bound
 * workflow: prepare (the upload-URL mutation), upload (the storage POST), and
 * an optional `complete` step. `upload()` resolves with
 * `{ storageId, prepared, completed }`.
 *
 * Uploads run in the browser only: during SSR, `upload()` rejects with
 * `CLIENT_UNAVAILABLE`. Failures reject with a `ConvexCallError` whose `phase`
 * names the phase that failed and whose `outcome` tells whether its request
 * was sent. Library codes: `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`,
 * `UPLOAD_IN_PROGRESS`, `CANCELLED`, `IDENTITY_CHANGED`, `CLIENT_UNAVAILABLE`,
 * `INVALID_UPLOAD_URL`.
 *
 * Pass the record the upload belongs to as per-call context:
 * `upload(file, args, { context })` captures it when called and hands it to
 * `url` and `complete` as `ctx.context`, so a selection that changes while the
 * file uploads does not change the target.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { api } from '#convex/api'
 *
 * const props = defineProps<{ documentId: Id<'documents'> }>()
 * const { upload, pending, progress, error, cancel } = useConvexFileUpload(
 *   api.files.generateUploadUrl,
 *   {
 *     maxSize: 5 * 1024 * 1024,
 *     allowedTypes: ['image/*'],
 *     complete: (
 *       op,
 *       { storageId, context: documentId }: UploadCompleteContext<string, Id<'documents'>>,
 *     ) => op.mutation(api.documents.attachFile, { documentId, storageId }),
 *   },
 * )
 *
 * async function onChange(event: Event) {
 *   const file = (event.target as HTMLInputElement).files?.[0]
 *   if (file) await upload(file, {}, { context: props.documentId }).catch(() => undefined)
 * }
 * </script>
 *
 * <template>
 *   <input type="file" :disabled="pending" @change="onChange" />
 *   <button v-if="pending" @click="cancel">Cancel {{ progress.percent }}%</button>
 *   <p v-if="error">{{ error.message }}</p>
 * </template>
 * ```
 */
export function useConvexFileUpload<
  Mutation extends UploadUrlMutation,
  Completed = undefined,
  Context = undefined,
>(
  mutation: Mutation,
  ...options: UploadOptionsParameter<FunctionReturnType<Mutation>, Completed, Context>
): UseConvexFileUploadReturn<Mutation, Completed, Context> {
  const input = options[0] as ConvexFileUploadInternalOptions | undefined
  const logger =
    readConvexRuntimeContext(useNuxtApp())?.logger ?? createLogger(getConvexRuntimeConfig().logging)
  const name = getFunctionName(mutation)
  return useConvexFileUploadInternal(mutation, {
    maxSize: input?.maxSize,
    allowedTypes: input?.allowedTypes,
    url: input?.url,
    complete: input?.complete,
    observer: {
      succeeded: ({ file, durationMs }) =>
        logger.upload({
          name,
          event: 'success',
          filename: file.name,
          size: file.size,
          duration: durationMs,
        }),
      failed: ({ file, error, durationMs }) =>
        logger.upload({
          name,
          event: 'error',
          filename: file.name,
          size: file.size,
          duration: durationMs,
          error,
        }),
    },
  }) as unknown as UseConvexFileUploadReturn<Mutation, Completed, Context>
}
