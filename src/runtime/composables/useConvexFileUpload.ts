/**
 * File upload composable for Convex storage.
 *
 * Inspired by nuxt-convex by @onmax (https://github.com/onmax/nuxt-convex)
 */

import type { FunctionArgs, FunctionReference, OptionalRestArgs } from 'convex/server'
import type { GenericId } from 'convex/values'
import { computed, getCurrentScope, onScopeDispose, shallowRef, type ComputedRef } from 'vue'

import { useNuxtApp } from '#imports'

import { ConvexCallError, normalizeConvexError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import { assertConvexComposableScope } from '../utils/composable-scope'
import { getFunctionName } from '../utils/convex-shared'
import { createIdentityChangedError, isIdentityChangedError } from '../utils/identity-changed-error'
import { createLogger } from '../utils/logger'
import { isFileTypeAllowed } from '../utils/mime-type'
import { getConvexRuntimeConfig } from '../utils/runtime-config'
import {
  executeFileUpload,
  isUploadAbortError,
  type UploadProgressInfo,
} from '../utils/upload-core'

export type { UploadProgressInfo } from '../utils/upload-core'

/** A public Convex mutation that generates a browser upload URL. */
export type UploadUrlMutation = FunctionReference<
  'mutation',
  'public',
  Record<string, unknown>,
  string
>

/**
 * Upload status representing the current state of the upload
 * - 'idle': not yet called or reset
 * - 'pending': upload in progress
 * - 'success': upload completed successfully
 * - 'error': upload failed
 */
export type UploadStatus = 'idle' | 'pending' | 'success' | 'error'

interface UploadViewState {
  status: UploadStatus
  error: ConvexCallError | undefined
  data: GenericId<'_storage'> | undefined
  progress: UploadProgressInfo
}

const INITIAL_UPLOAD_VIEW_STATE: UploadViewState = {
  status: 'idle',
  error: undefined,
  data: undefined,
  progress: Object.freeze({ loaded: 0, total: 0, percent: 0 }),
}

/**
 * Return value from useConvexFileUpload
 */
export interface UseConvexFileUploadReturn<Mutation extends UploadUrlMutation> {
  /**
   * Upload a file. Returns the storageId on success.
   * Automatically tracks status, error, progress, and data.
   * Throws on error (use try/catch or check error ref after).
   *
   * @param file - The file to upload
   * @param args - Validator-derived args for the generateUploadUrl mutation
   */
  upload: (file: File, ...args: OptionalRestArgs<Mutation>) => Promise<GenericId<'_storage'>>

  /**
   * StorageId from the last successful upload.
   * undefined if upload hasn't succeeded yet.
   */
  readonly data: ComputedRef<GenericId<'_storage'> | undefined>

  /**
   * Upload status for explicit state management.
   */
  readonly status: ComputedRef<UploadStatus>

  /**
   * True when upload is in progress.
   * Equivalent to status === 'pending'.
   */
  readonly pending: ComputedRef<boolean>

  /**
   * Byte-level progress for the current upload.
   */
  readonly progress: ComputedRef<UploadProgressInfo>

  /**
   * Error from the last upload attempt as the normalized {@link ConvexCallError}.
   * undefined if no error or upload hasn't been called.
   */
  readonly error: ComputedRef<ConvexCallError | undefined>

  /**
   * Cancel any in-progress upload and reset state.
   * Aborts XHR, clears error, data, and progress.
   */
  readonly cancel: () => void
}

/**
 * Options for useConvexFileUpload
 */
export interface UseConvexFileUploadOptions {
  /**
   * Maximum file size in bytes.
   * Files exceeding this size will be rejected before upload starts.
   * @example 5 * 1024 * 1024 // 5MB
   */
  readonly maxSize?: number
  /**
   * Allowed MIME types.
   * Files not matching these types will be rejected before upload starts.
   *
   * Supports wildcards: `image/*` matches any image type, `video/*` matches any video, etc.
   *
   * @example ['image/jpeg', 'image/png'] // Exact types only
   * @example ['image/*'] // Any image type
   * @example ['image/*', 'application/pdf'] // Any image or PDF
   */
  readonly allowedTypes?: readonly string[]
}

/**
 * Composable for uploading files to Convex file storage with progress tracking.
 *
 * Handles the complete upload flow:
 * 1. Generating an upload URL via mutation
 * 2. POSTing the file to that URL (with progress tracking via XHR)
 * 3. Returning the resulting storageId
 *
 * API designed to match useConvexMutation for consistency:
 * - `data` - storageId from last successful upload
 * - `status` - 'idle' | 'pending' | 'success' | 'error'
 * - `pending` - boolean shorthand for status === 'pending'
 * - `progress` - byte-level upload progress
 * - `error` - Error | undefined
 *
 * Note: File uploads only work on the client side.
 *
 * @example Basic usage with progress tracking
 * ```vue
 * <script setup>
 * import { api } from '#convex/api'
 *
 * const {
 *   upload,
 *   pending,
 *   progress,
 *   error,
 *   data: storageId,
 * } = useConvexFileUpload(api.files.generateUploadUrl)
 *
 * async function handleFile(event: Event) {
 *   const input = event.target as HTMLInputElement
 *   if (!input.files?.[0]) return
 *
 *   try {
 *     const id = await upload(input.files[0])
 *     console.log('Uploaded:', id)
 *   } catch {
 *     // error is automatically tracked
 *   }
 * }
 * </script>
 *
 * <template>
 *   <input type="file" @change="handleFile" :disabled="pending" />
 *   <div v-if="pending">Uploading: {{ progress.percent }}%</div>
 *   <p v-if="error" class="error">{{ error.message }}</p>
 * </template>
 * ```
 *
 * @example With cancel support
 * ```vue
 * <script setup>
 * import { api } from '#convex/api'
 *
 * const { upload, pending, progress, cancel } = useConvexFileUpload(
 *   api.files.generateUploadUrl
 * )
 * </script>
 *
 * <template>
 *   <div v-if="pending">
 *     Uploading: {{ progress.percent }}%
 *     <button @click="cancel">Cancel</button>
 *   </div>
 * </template>
 * ```
 *
 * @example Saving storageId to a document
 * ```vue
 * <script setup>
 * import { api } from '#convex/api'
 *
 * const { upload, pending, progress } = useConvexFileUpload(api.files.generateUploadUrl)
 * const saveDocument = useConvexMutation(api.documents.create)
 *
 * async function handleUpload(file: File, title: string) {
 *   const storageId = await upload(file)
 *   await saveDocument({ title, fileId: storageId })
 * }
 * </script>
 * ```
 */
export function useConvexFileUpload<Mutation extends UploadUrlMutation>(
  generateUploadUrlMutation: Mutation,
  options?: UseConvexFileUploadOptions,
): UseConvexFileUploadReturn<Mutation> {
  const fnName = getFunctionName(generateUploadUrlMutation)
  const currentScope = getCurrentScope()
  assertConvexComposableScope('useConvexFileUpload', import.meta.client, currentScope)

  const nuxtApp = useNuxtApp()
  const runtime = readConvexRuntimeContext(nuxtApp)
  const attachment = runtime?.attachment
  const identityObserver = attachment?.identity
  const logger = runtime?.logger ?? createLogger(getConvexRuntimeConfig().logging)
  const getIdentityGeneration = () => identityObserver?.snapshot().identityGeneration ?? 0

  // One snapshot is the canonical upload view state. Publishing a transition
  // atomically prevents a synchronous watcher from observing (or re-entering
  // through) a partially-cleared status/error/data/progress combination.
  const viewState = shallowRef<UploadViewState>(INITIAL_UPLOAD_VIEW_STATE)

  let currentAttempt: AbortController | null = null
  let observedIdentityGeneration = getIdentityGeneration()

  // Computed - matches useConvexMutation pattern
  const status = computed(() => viewState.value.status)
  const pending = computed(() => viewState.value.status === 'pending')
  const error = computed(() => viewState.value.error)
  const data = computed(() => viewState.value.data)
  const progress = computed(() => viewState.value.progress)

  const clearUploadState = (
    error: unknown = new DOMException('Upload cancelled', 'AbortError'),
  ) => {
    // Snapshot A before publishing idle. A synchronous watcher may start B
    // while the ref setter runs; cleanup below must only retire the snapshot.
    const attempt = currentAttempt
    viewState.value = INITIAL_UPLOAD_VIEW_STATE
    if (currentAttempt === attempt) currentAttempt = null
    attempt?.abort(error)
  }

  // Cancel function - aborts upload and resets state
  const cancel = clearUploadState

  // Cleanup on scope dispose (component unmount), and retire all retained or
  // in-flight state synchronously when the authenticated principal changes.
  if (currentScope) {
    const stopIdentitySubscription = identityObserver?.subscribe(() => {
      const generation = getIdentityGeneration()
      if (generation === observedIdentityGeneration) return
      observedIdentityGeneration = generation
      clearUploadState(createIdentityChangedError('upload'))
    })
    onScopeDispose(() => {
      stopIdentitySubscription?.()
      clearUploadState()
    })
  }

  // The upload function
  const upload = async (
    file: File,
    ...mutationArgs: OptionalRestArgs<Mutation>
  ): Promise<GenericId<'_storage'>> => {
    const startTime = Date.now()
    const identityGeneration = getIdentityGeneration()
    const identityChanged = () => getIdentityGeneration() !== identityGeneration

    // The published state is the synchronous concurrency guard, including the
    // upload-URL phase before XHR begins.
    if (viewState.value.status === 'pending') {
      const err = new ConvexCallError({
        kind: 'unknown',
        message: 'Upload already in progress for this composable instance',
      })
      logger.upload({
        name: fnName,
        event: 'error',
        filename: file.name,
        size: file.size,
        error: err,
      })
      throw err
    }

    const requireCurrentIdentity = () => {
      if (identityChanged()) throw createIdentityChangedError('upload')
    }

    const publishTerminalState = (next: UploadViewState) => {
      requireCurrentIdentity()
      viewState.value = next
      // A same-identity watcher may legitimately start B here. Only an
      // identity transition invalidates A's already-terminal result.
      requireCurrentIdentity()
    }

    const publishConvexError = (err: ConvexCallError): ConvexCallError => {
      publishTerminalState({
        ...viewState.value,
        status: 'error',
        error: err,
      })

      logger.upload({
        name: fnName,
        event: 'error',
        filename: file.name,
        size: file.size,
        duration: Date.now() - startTime,
        error: err,
      })

      requireCurrentIdentity()
      return err
    }
    const publishError = (rawError: unknown): ConvexCallError =>
      publishConvexError(normalizeConvexError(rawError))

    // Client-side validation before uploading
    let validationError: ConvexCallError | undefined
    if (options?.maxSize && file.size > options.maxSize) {
      validationError = new ConvexCallError({
        kind: 'unknown',
        message: `File size ${file.size} bytes exceeds maximum ${options.maxSize} bytes`,
      })
    } else if (options?.allowedTypes && !isFileTypeAllowed(file.type, options.allowedTypes)) {
      validationError = new ConvexCallError({
        kind: 'unknown',
        message: `File type "${file.type}" not allowed. Allowed: ${options.allowedTypes.join(', ')}`,
      })
    }
    if (validationError) throw publishConvexError(validationError)

    if (import.meta.server || !attachment || typeof attachment.client.mutation !== 'function') {
      throw publishConvexError(
        new ConvexCallError({
          kind: 'unknown',
          message:
            '[useConvexFileUpload] Convex client is unavailable. Upload files from the browser after configuring a Convex URL.',
        }),
      )
    }

    const attempt = new AbortController()
    currentAttempt = attempt

    const isCurrentUpload = () =>
      currentAttempt === attempt && !identityChanged() && !attempt.signal.aborted
    const requireCurrentUpload = () => {
      requireCurrentIdentity()
      if (!isCurrentUpload()) throw new DOMException('Upload cancelled', 'AbortError')
    }

    try {
      requireCurrentUpload()
      viewState.value = {
        ...viewState.value,
        status: 'pending',
        error: undefined,
        progress: { loaded: 0, total: file.size, percent: 0 },
      }
      requireCurrentUpload()

      const storageId = await executeFileUpload(
        attachment.client,
        generateUploadUrlMutation,
        (mutationArgs[0] ?? {}) as FunctionArgs<Mutation>,
        file,
        {
          signal: attempt.signal,
          onProgress: (info) => {
            if (!isCurrentUpload()) return
            viewState.value = {
              ...viewState.value,
              progress: info,
            }
          },
        },
      )

      requireCurrentUpload()
      publishTerminalState({
        ...viewState.value,
        status: 'success',
        data: storageId,
      })

      const duration = Date.now() - startTime
      logger.upload({
        name: fnName,
        event: 'success',
        filename: file.name,
        size: file.size,
        duration,
      })

      requireCurrentIdentity()
      return storageId
    } catch (e) {
      if (identityChanged() || isIdentityChangedError(e)) {
        if (currentAttempt === attempt) {
          clearUploadState(createIdentityChangedError('upload'))
        }
        throw isIdentityChangedError(e) ? e : createIdentityChangedError('upload')
      }
      if (currentAttempt !== attempt) {
        throw isUploadAbortError(e) ? e : new DOMException('Upload cancelled', 'AbortError')
      }
      // Don't set error state for user-initiated cancellation
      if (isUploadAbortError(e)) {
        throw e
      }

      // Normalize and publish every validation/transport failure through one
      // identity-guarded path.
      throw publishError(e)
    } finally {
      if (currentAttempt === attempt) currentAttempt = null
    }
  }

  return {
    upload,
    data,
    status,
    pending,
    progress,
    error,
    cancel,
  }
}
