import type { FunctionArgs, FunctionReference, OptionalRestArgs } from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId } from 'convex/values'
import { computed, getCurrentScope, onScopeDispose, type ComputedRef } from 'vue'

import type { ConvexCallError } from './errors'
import {
  createFileUploadController,
  type ConvexFileUploadObserver,
} from './internal/upload-controller'
import type { UploadProgressInfo } from './internal/upload-transport'
import { useOptionalBetterConvexRuntime } from './runtime-context'
import type { ConvexCallStatus } from './use-callable'

export type { UploadProgressInfo }

/** A public Convex mutation that returns a browser upload URL. */
export type UploadUrlMutation = FunctionReference<
  'mutation',
  'public',
  Record<string, unknown>,
  string
>

export interface UseConvexFileUploadOptions {
  /**
   * Maximum file size in bytes. A larger file fails with `FILE_TOO_LARGE`
   * before any request is made.
   * @example 5 * 1024 * 1024 // 5 MB
   */
  readonly maxSize?: number
  /**
   * Allowed MIME types. Supports exact types and top-level wildcards such as
   * `image/*`. Another type fails with `FILE_TYPE_NOT_ALLOWED` before any
   * request is made.
   * @example ['image/*', 'application/pdf']
   */
  readonly allowedTypes?: readonly string[]
}

export interface UseConvexFileUploadReturn<Mutation extends UploadUrlMutation> {
  /**
   * Upload one file and resolve with its storage ID. Rejects with a
   * `ConvexCallError`: `FILE_TOO_LARGE` or `FILE_TYPE_NOT_ALLOWED` (no request
   * made), `UPLOAD_IN_PROGRESS` (another upload of this composable is
   * pending), `CANCELLED` (`cancel()`, `reset()`, or scope disposal),
   * `IDENTITY_CHANGED` (the signed-in identity changed), `CLIENT_UNAVAILABLE`
   * (no browser Convex client, for example during SSR), or the normalized
   * mutation or transport failure. Cancellation and identity changes return
   * the state to `idle` instead of `error`.
   *
   * @param file The file to upload.
   * @param args Validator-derived arguments for the upload-URL mutation.
   */
  readonly upload: (
    file: File,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<GenericId<'_storage'>>
  /** The storage ID of the last successful upload. */
  readonly data: ComputedRef<GenericId<'_storage'> | undefined>
  /** `idle` until an upload starts, and again after `cancel()`, `reset()`, or an identity change. */
  readonly status: ComputedRef<ConvexCallStatus>
  /** An upload is in progress, including the upload-URL request. */
  readonly pending: ComputedRef<boolean>
  /** The last failure; `error.functionName` names the upload-URL mutation. */
  readonly error: ComputedRef<ConvexCallError | undefined>
  /** Byte progress of the current upload. */
  readonly progress: ComputedRef<UploadProgressInfo>
  /** Abort the in-flight upload, if any, and return to `idle`. */
  readonly cancel: () => void
  /** Abort any in-flight upload and clear `data`, `error`, and `progress`. */
  readonly reset: () => void
}

/** Adapter options for the one upload lifecycle; `observer` feeds the Nuxt logger. */
export interface ConvexFileUploadInternalOptions extends UseConvexFileUploadOptions {
  readonly observer?: ConvexFileUploadObserver
}

/**
 * Upload files to Convex storage with byte progress.
 *
 * The composable calls the upload-URL mutation, POSTs the file to that URL,
 * and returns the storage ID. It uploads one file at a time and is bound to
 * the signed-in identity that started the upload.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { upload, pending, progress, error, cancel } = useConvexFileUpload(
 *   api.files.generateUploadUrl,
 *   { maxSize: 5 * 1024 * 1024, allowedTypes: ['image/*'] },
 * )
 * const { mutate: saveAvatar } = useConvexMutation(api.users.setAvatar)
 *
 * async function onChange(event: Event) {
 *   const file = (event.target as HTMLInputElement).files?.[0]
 *   if (!file) return
 *   const storageId = await upload(file).catch(() => undefined)
 *   if (storageId) await saveAvatar({ storageId })
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
  return useConvexFileUploadInternal(mutation, {
    maxSize: options?.maxSize,
    allowedTypes: options?.allowedTypes,
  })
}

/** Adapter entry for {@link useConvexFileUpload}; the same lifecycle plus an observer. */
export function useConvexFileUploadInternal<Mutation extends UploadUrlMutation>(
  mutation: Mutation,
  options?: ConvexFileUploadInternalOptions,
): UseConvexFileUploadReturn<Mutation> {
  if (!getCurrentScope()) {
    throw new Error('[better-convex-vue] useConvexFileUpload must run inside a Vue effect scope')
  }
  // Setup is allowed without a browser runtime (SSR); uploading is not.
  const runtime = useOptionalBetterConvexRuntime()
  const identity = runtime?.browser.identity
  const controller = createFileUploadController({
    mutation,
    functionName: getFunctionName(mutation),
    maxSize: options?.maxSize,
    allowedTypes: options?.allowedTypes,
    client: runtime?.browser.handle ?? null,
    getIdentityGeneration: () => identity?.snapshot().identityGeneration ?? 0,
    subscribeIdentityChange: identity ? (listener) => identity.subscribe(listener) : undefined,
    observer: options?.observer,
  })
  onScopeDispose(controller.dispose)

  const state = controller.state
  return Object.freeze({
    upload: (file: File, ...args: OptionalRestArgs<Mutation>) =>
      controller.upload(file, (args[0] ?? {}) as FunctionArgs<Mutation>),
    data: computed(() => state.value.data),
    status: computed(() => state.value.status),
    pending: computed(() => state.value.status === 'pending'),
    error: computed(() => state.value.error),
    progress: computed(() => state.value.progress),
    cancel: controller.cancel,
    reset: controller.reset,
  })
}
