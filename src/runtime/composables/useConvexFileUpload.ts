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
import { useConvexFileUploadInternal } from '@lupinum/better-convex-vue/internal'
import { getFunctionName } from 'convex/server'

import { useNuxtApp } from '#imports'

import { readConvexRuntimeContext } from '../runtime-context'
import { createLogger } from '../utils/logger'
import { getConvexRuntimeConfig } from '../utils/runtime-config'

export type {
  UploadProgressInfo,
  UploadUrlMutation,
  UseConvexFileUploadOptions,
  UseConvexFileUploadReturn,
} from '@lupinum/better-convex-vue'

/**
 * Upload files to Convex storage with byte progress.
 *
 * The composable calls the upload-URL mutation, POSTs the file to that URL,
 * and returns the storage ID. Uploads run in the browser only: during SSR,
 * `upload()` rejects with `CLIENT_UNAVAILABLE`. Library failures reject with a
 * `ConvexCallError` code (`FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`,
 * `UPLOAD_IN_PROGRESS`, `CANCELLED`, `IDENTITY_CHANGED`, `CLIENT_UNAVAILABLE`).
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { api } from '#convex/api'
 *
 * const { upload, pending, progress, error, cancel } = useConvexFileUpload(
 *   api.files.generateUploadUrl,
 *   { maxSize: 5 * 1024 * 1024, allowedTypes: ['image/*'] },
 * )
 * const { mutate: createDocument } = useConvexMutation(api.documents.create)
 *
 * async function onChange(event: Event) {
 *   const file = (event.target as HTMLInputElement).files?.[0]
 *   if (!file) return
 *   const storageId = await upload(file).catch(() => undefined)
 *   if (storageId) await createDocument({ fileId: storageId })
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
export function useConvexFileUpload<Mutation extends UploadUrlMutation>(
  mutation: Mutation,
  options?: UseConvexFileUploadOptions,
): UseConvexFileUploadReturn<Mutation> {
  const logger =
    readConvexRuntimeContext(useNuxtApp())?.logger ?? createLogger(getConvexRuntimeConfig().logging)
  const name = getFunctionName(mutation)
  return useConvexFileUploadInternal(mutation, {
    maxSize: options?.maxSize,
    allowedTypes: options?.allowedTypes,
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
  })
}
