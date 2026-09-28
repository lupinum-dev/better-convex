import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { computed, onScopeDispose, type ComputedRef } from 'vue'

import type { ConvexCallError } from './errors'
import { toPublicOperation, type ConvexOperation } from './internal/operation-controller'
import {
  createFileUploadController,
  type ConvexFileUploadObserver,
  type ConvexFileUploadResult,
  type UploadCompleteContext,
} from './internal/upload-controller'
import type { UploadProgressInfo } from './internal/upload-transport'
import { useOptionalBetterConvexRuntime } from './runtime-context'
import type { ConvexCallStatus } from './use-callable'
import { useOperationController } from './use-operation'

export type { ConvexFileUploadResult, UploadCompleteContext, UploadProgressInfo }

/**
 * A public Convex mutation that prepares an upload. It returns the upload URL,
 * or a value the `url` option selects the URL from.
 */
export type UploadUrlMutation = FunctionReference<
  'mutation',
  'public',
  Record<string, unknown>,
  unknown
>

/**
 * The completion step. It runs as part of the upload's operation once the
 * file is stored: send its Convex calls through `operation` so that they
 * belong to the same signed-in identity, for example
 * `(op, { storageId, context }) => op.mutation(api.notes.attachImage, { noteId: context, storageId })`.
 * It may send several steps; its result becomes `data.completed`.
 */
export type UploadComplete<Prepared = unknown, Completed = unknown, Context = undefined> = (
  operation: ConvexOperation,
  ctx: UploadCompleteContext<Prepared, Context>,
) => Promise<Completed>

/** Select the upload URL; `ctx.context` is the `upload()` call's context. */
type UploadUrlSelector<Prepared, Context> = (
  prepared: Prepared,
  ctx: { readonly file: File; readonly context: Context },
) => string

type UploadUrlOption<Prepared, Context> = [Prepared] extends [string]
  ? {
      /** Select the upload URL from the upload-URL mutation's result. */
      readonly url?: UploadUrlSelector<Prepared, Context>
    }
  : {
      /**
       * Select the upload URL from the upload-URL mutation's result. Required
       * when that result is not a string.
       */
      readonly url: UploadUrlSelector<Prepared, Context>
    }

/**
 * The arguments of `upload()` after the file: the upload-URL mutation's
 * arguments, then `{ context }`, the per-call value `url` and `complete`
 * receive as `ctx.context`. `{ context }` is required once `complete` or
 * `url` declares a context type that does not include `undefined`.
 */
type UploadCallArgs<
  Mutation extends UploadUrlMutation,
  Context = undefined,
> = undefined extends Context
  ? [...args: OptionalRestArgs<Mutation>, options?: { readonly context?: Context }]
  : [args: OptionalRestArgs<Mutation>[0], options: { readonly context: Context }]

export type UseConvexFileUploadOptions<
  Prepared = string,
  Completed = undefined,
  Context = undefined,
> = UploadUrlOption<Prepared, Context> & {
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
  /**
   * Complete the upload in the same operation, for example by attaching the
   * stored file to a record. Send each Convex call through the operation it
   * receives. `pending` stays `true` until it finishes and `data.completed`
   * holds its result.
   *
   * Take the record to attach to from `ctx.context`, the value passed as
   * `upload(file, args, { context })`, rather than from component state: the
   * context is captured when `upload()` is called, so a selection that
   * changes while the file uploads does not change the target. Declare its
   * type on the parameter, for example
   * `(op, { storageId, context }: UploadCompleteContext<string, Id<'assets'>>) => ...`.
   *
   * A `complete` failure's `outcome` covers every completion call, not only
   * the one that failed. `outcome: 'not-sent'` means that no completion call
   * was sent: when the identity changes after the file was stored but before
   * the first completion call, the stored file exists but nothing references
   * it. Once one completion call was sent, a later failure records
   * `outcome: 'unknown'` (or none for a confirmed server rejection): an
   * earlier call may have referenced the file. Clean up unreferenced files on
   * the server.
   */
  readonly complete?: UploadComplete<Prepared, Completed, Context>
}

type UploadOptionsParameter<Prepared, Completed, Context> = [Prepared] extends [string]
  ? [options?: UseConvexFileUploadOptions<Prepared, Completed, Context>]
  : [options: UseConvexFileUploadOptions<Prepared, Completed, Context>]

export interface UseConvexFileUploadReturn<
  Mutation extends UploadUrlMutation,
  Completed = undefined,
  Context = undefined,
> {
  /**
   * Prepare, upload, and complete one file. Resolves with
   * `{ storageId, prepared, completed }`.
   *
   * Rejects with a `ConvexCallError`: `FILE_TOO_LARGE` or
   * `FILE_TYPE_NOT_ALLOWED` (no request made), `UPLOAD_IN_PROGRESS` (another
   * upload of this composable is pending), `CANCELLED` (`cancel()`, `reset()`,
   * or scope disposal), `IDENTITY_CHANGED` (the signed-in identity changed),
   * `CLIENT_UNAVAILABLE` (no browser Convex client, for example during SSR),
   * `INVALID_UPLOAD_URL`, or the normalized mutation, action, or transport
   * failure. `error.phase` names the phase that failed (every earlier phase
   * succeeded) and `error.outcome` whether that phase sent a request.
   * `IDENTITY_CHANGED` and `CANCELLED` always record an `outcome`.
   * Cancellation and identity changes return the state to `idle` instead of
   * `error`.
   *
   * @param file The file to upload.
   * @param args Validator-derived arguments for the upload-URL mutation,
   * then `{ context }`: a per-call value handed to `url` and `complete` as
   * `ctx.context`, like Convex's `mutation(ref, args, options)`. Plain
   * objects and arrays are copied when `upload()` is called, so pass values
   * (IDs), not refs.
   */
  readonly upload: (
    file: File,
    ...args: UploadCallArgs<Mutation, Context>
  ) => Promise<ConvexFileUploadResult<FunctionReturnType<Mutation>, Completed>>
  /** The result of the last successful upload. */
  readonly data: ComputedRef<
    ConvexFileUploadResult<FunctionReturnType<Mutation>, Completed> | undefined
  >
  /** `idle` until an upload starts, and again after `cancel()`, `reset()`, or an identity change. */
  readonly status: ComputedRef<ConvexCallStatus>
  /** An upload is in progress: prepare, upload, or complete. */
  readonly pending: ComputedRef<boolean>
  /**
   * The last failure. `error.functionName` names the Convex function that
   * failed: the upload-URL mutation, or a completion call.
   */
  readonly error: ComputedRef<ConvexCallError | undefined>
  /** Byte progress of the current storage POST. */
  readonly progress: ComputedRef<UploadProgressInfo>
  /**
   * Stop the in-flight upload, if any, and return to `idle`. A phase not yet
   * sent is never sent and the storage POST is aborted; a mutation or action
   * already sent runs to completion.
   */
  readonly cancel: () => void
  /** Like `cancel()`, and clear `data`, `error`, and `progress`. */
  readonly reset: () => void
}

/** Adapter options for the one upload lifecycle; `observer` feeds the Nuxt logger. */
export type ConvexFileUploadInternalOptions = {
  readonly maxSize?: number
  readonly allowedTypes?: readonly string[]
  readonly url?: UploadUrlSelector<never, never>
  readonly complete?: UploadComplete<never, unknown, never>
  readonly observer?: ConvexFileUploadObserver
}

/**
 * Upload files to Convex storage with byte progress, as one identity-bound
 * workflow: prepare (the upload-URL mutation), upload (the storage POST), and
 * an optional `complete` mutation or action.
 *
 * All phases run as one operation bound to the signed-in identity that was
 * current when `upload()` started: after an identity change no later phase is
 * sent. The composable uploads one file at a time.
 *
 * Pass the record the upload belongs to as per-call context, not through
 * component state that may change while the file uploads:
 * `upload(file, args, { context })` hands it to `url` and `complete` as
 * `ctx.context`.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const props = defineProps<{ noteId: Id<'notes'> }>()
 * const { upload, pending, progress, error, cancel } = useConvexFileUpload(
 *   api.files.generateUploadUrl,
 *   {
 *     maxSize: 5 * 1024 * 1024,
 *     allowedTypes: ['image/*'],
 *     complete: (op, { storageId, context: noteId }: UploadCompleteContext<string, Id<'notes'>>) =>
 *       op.mutation(api.notes.attachImage, { noteId, storageId }),
 *   },
 * )
 *
 * async function onChange(event: Event) {
 *   const file = (event.target as HTMLInputElement).files?.[0]
 *   if (file) await upload(file, {}, { context: props.noteId }).catch(() => undefined)
 * }
 * </script>
 *
 * <template>
 *   <input type="file" :disabled="pending" @change="onChange" />
 *   <button v-if="pending" @click="cancel">Cancel {{ progress.percent }}%</button>
 *   <p v-if="error">{{ error.message }}</p>
 * </template>
 * ```
 *
 * When the upload-URL mutation returns an object, `url` selects the URL:
 * `useConvexFileUpload(api.files.createUploadSession, { url: (session) => session.uploadUrl })`.
 */
export function useConvexFileUpload<
  Mutation extends UploadUrlMutation,
  Completed = undefined,
  Context = undefined,
>(
  mutation: Mutation,
  ...options: UploadOptionsParameter<FunctionReturnType<Mutation>, Completed, Context>
): UseConvexFileUploadReturn<Mutation, Completed, Context> {
  const input = options[0] as UseConvexFileUploadOptions<unknown, unknown, unknown> | undefined
  return useConvexFileUploadInternal(mutation, {
    maxSize: input?.maxSize,
    allowedTypes: input?.allowedTypes,
    url: input?.url as ConvexFileUploadInternalOptions['url'],
    complete: input?.complete as ConvexFileUploadInternalOptions['complete'],
  }) as unknown as UseConvexFileUploadReturn<Mutation, Completed, Context>
}

/** Adapter entry for {@link useConvexFileUpload}; the same lifecycle plus an observer. */
export function useConvexFileUploadInternal<Mutation extends UploadUrlMutation>(
  mutation: Mutation,
  options?: ConvexFileUploadInternalOptions,
): UseConvexFileUploadReturn<Mutation, unknown, unknown> {
  const operations = useOperationController('useConvexFileUpload')
  const runtime = useOptionalBetterConvexRuntime()
  const completion = options?.complete as UploadComplete<unknown, unknown, unknown> | undefined
  const controller = createFileUploadController({
    functionName: getFunctionName(mutation),
    maxSize: options?.maxSize,
    allowedTypes: options?.allowedTypes,
    available: runtime !== null,
    operations,
    prepare: (operation, args) => operation.mutation(mutation, args as never),
    url: options?.url as UploadUrlSelector<unknown, unknown> | undefined,
    complete: completion
      ? (operation, context) => completion(toPublicOperation(operation), context)
      : undefined,
    observer: options?.observer,
  })
  onScopeDispose(controller.dispose)

  const state = controller.state
  return {
    upload: (file: File, args?: Record<string, unknown>, call?: { context?: unknown }) =>
      controller.upload(file, args ?? {}, call?.context),
    data: computed(() => state.value.data),
    status: computed(() => state.value.status),
    pending: computed(() => state.value.status === 'pending'),
    error: computed(() => state.value.error),
    progress: computed(() => state.value.progress),
    cancel: controller.cancel,
    reset: controller.reset,
  } as unknown as UseConvexFileUploadReturn<Mutation, unknown, unknown>
}
