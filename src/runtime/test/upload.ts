import type { BetterConvexAttachment } from '@lupinum/better-convex-vue/embedded'
import type { FunctionArgs, FunctionReference, OptionalRestArgs } from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId } from 'convex/values'
import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue'

import type {
  UploadProgressInfo,
  UploadUrlMutation,
  UseConvexFileUploadOptions,
  UseConvexFileUploadReturn,
} from '../composables/useConvexFileUpload'
import { ConvexCallError, normalizeConvexError, type ConvexCallErrorCode } from '../errors'
import type { ConvexCallStatus } from '../utils/types'

export interface BetterConvexTestUploadCall<Mutation extends UploadUrlMutation> {
  readonly file: File
  readonly args: FunctionArgs<Mutation>
}

export interface BetterConvexTestUploadController<Mutation extends UploadUrlMutation> {
  readonly calls: readonly BetterConvexTestUploadCall<Mutation>[]
  resolve(storageId: GenericId<'_storage'>): void
  reject(error: unknown): void
  progress(progress: UploadProgressInfo): void
  /** Forget the configured outcome and cancel pending uploads with `CANCELLED`. */
  reset(): void
}

export interface BetterConvexTestFileUploadComposable {
  <Mutation extends UploadUrlMutation>(
    mutation: Mutation,
    options?: UseConvexFileUploadOptions,
  ): UseConvexFileUploadReturn<Mutation>
}

interface UploadBehavior {
  readonly state: 'resolved' | 'rejected'
  readonly value: unknown
}

interface UploadAttempt {
  readonly resolve: (storageId: GenericId<'_storage'>) => void
  readonly reject: (error: unknown) => void
  readonly publishProgress: (progress: UploadProgressInfo) => void
  /** Retire the attempt as `upload.cancel()` would. */
  readonly cancel: () => void
}

interface UploadRecord {
  readonly calls: BetterConvexTestUploadCall<UploadUrlMutation>[]
  readonly pending: Set<UploadAttempt>
  behavior?: UploadBehavior
}

interface UploadViewState {
  readonly status: ConvexCallStatus
  readonly data?: GenericId<'_storage'>
  readonly error?: ConvexCallError
  readonly progress: UploadProgressInfo
}

const EMPTY_PROGRESS: UploadProgressInfo = Object.freeze({ loaded: 0, total: 0, percent: 0 })
const IDLE_STATE: UploadViewState = Object.freeze({ status: 'idle', progress: EMPTY_PROGRESS })

function progressSnapshot(progress: UploadProgressInfo): UploadProgressInfo {
  return Object.freeze({
    loaded: progress.loaded,
    total: progress.total,
    percent: progress.percent,
  })
}

function typeAllowed(type: string, allowed: readonly string[]): boolean {
  return allowed.some((candidate) =>
    candidate.endsWith('/*') ? type.startsWith(candidate.slice(0, -1)) : candidate === type,
  )
}

function libraryError(code: ConvexCallErrorCode, message: string, functionName: string) {
  return new ConvexCallError({ kind: 'unknown', code, message, functionName })
}

function cancelledError(functionName: string): ConvexCallError {
  return libraryError('CANCELLED', 'Convex upload cancelled before it settled.', functionName)
}

function identityChangedError(functionName: string): ConvexCallError {
  return new ConvexCallError({
    kind: 'authentication',
    code: 'IDENTITY_CHANGED',
    message:
      'Convex upload rejected: the auth identity changed before it settled (IDENTITY_CHANGED).',
    functionName,
  })
}

/**
 * The test double for `useConvexFileUpload`. It keeps the public contract of
 * the real composable (error codes, `cancel()`/`reset()` returning to `idle`,
 * identity fencing, scope disposal) while tests settle each upload through
 * the controller returned by `upload(mutation)`.
 */
export function createBetterConvexTestUploads(identity?: BetterConvexAttachment['identity']) {
  const records = new Map<string, UploadRecord>()

  const recordFor = (mutation: FunctionReference<'mutation'>): UploadRecord => {
    const key = getFunctionName(mutation)
    let record = records.get(key)
    if (!record) {
      record = { calls: [], pending: new Set() }
      records.set(key, record)
    }
    return record
  }

  const settle = (record: UploadRecord, behavior: UploadBehavior) => {
    record.behavior = behavior
    for (const attempt of [...record.pending]) {
      if (behavior.state === 'resolved') {
        attempt.resolve(behavior.value as GenericId<'_storage'>)
      } else {
        attempt.reject(behavior.value)
      }
    }
    record.pending.clear()
  }

  function upload<Mutation extends UploadUrlMutation>(
    mutation: Mutation,
  ): BetterConvexTestUploadController<Mutation> {
    const record = recordFor(mutation)
    return {
      get calls() {
        return record.calls.slice() as BetterConvexTestUploadCall<Mutation>[]
      },
      resolve: (storageId) => settle(record, { state: 'resolved', value: storageId }),
      reject: (error) => settle(record, { state: 'rejected', value: error }),
      progress: (progress) => {
        const snapshot = progressSnapshot(progress)
        for (const attempt of record.pending) attempt.publishProgress(snapshot)
      },
      reset: () => {
        record.behavior = undefined
        for (const attempt of [...record.pending]) attempt.cancel()
        record.pending.clear()
      },
    }
  }

  const useConvexFileUpload: BetterConvexTestFileUploadComposable = <
    Mutation extends UploadUrlMutation,
  >(
    mutation: Mutation,
    options: UseConvexFileUploadOptions = {},
  ): UseConvexFileUploadReturn<Mutation> => {
    if (!getCurrentScope()) {
      throw new Error('[better-convex-test] useConvexFileUpload must run inside a Vue effect scope')
    }
    const functionName = getFunctionName(mutation)
    const record = recordFor(mutation)
    const state = shallowRef<UploadViewState>(IDLE_STATE)
    let active: UploadAttempt | null = null
    const retiredReasons = new WeakMap<UploadAttempt, ConvexCallError>()
    let disposed = false
    let generation = identity?.snapshot().identityGeneration ?? 0

    const retire = (reason: ConvexCallError) => {
      const attempt = active
      active = null
      state.value = IDLE_STATE
      if (attempt) {
        retiredReasons.set(attempt, reason)
        record.pending.delete(attempt)
        attempt.reject(reason)
      }
    }

    const stopIdentity = identity?.subscribe(() => {
      const next = identity.snapshot().identityGeneration
      if (next === generation) return
      generation = next
      retire(identityChangedError(functionName))
    })
    onScopeDispose(() => {
      disposed = true
      stopIdentity?.()
      retire(cancelledError(functionName))
    })

    const run = async (
      file: File,
      ...args: OptionalRestArgs<Mutation>
    ): Promise<GenericId<'_storage'>> => {
      if (disposed) throw cancelledError(functionName)
      if (state.value.status === 'pending') {
        throw libraryError(
          'UPLOAD_IN_PROGRESS',
          'An upload is already in progress for this composable.',
          functionName,
        )
      }
      if (options.maxSize !== undefined && file.size > options.maxSize) {
        const error = libraryError(
          'FILE_TOO_LARGE',
          `File size ${file.size} bytes exceeds maximum ${options.maxSize} bytes`,
          functionName,
        )
        state.value = { status: 'error', error, progress: EMPTY_PROGRESS }
        throw error
      }
      if (options.allowedTypes && !typeAllowed(file.type, options.allowedTypes)) {
        const error = libraryError(
          'FILE_TYPE_NOT_ALLOWED',
          `File type "${file.type}" not allowed. Allowed: ${options.allowedTypes.join(', ')}`,
          functionName,
        )
        state.value = { status: 'error', error, progress: EMPTY_PROGRESS }
        throw error
      }

      record.calls.push({ file, args: (args[0] ?? {}) as FunctionArgs<Mutation> })
      state.value = {
        status: 'pending',
        progress: progressSnapshot({ loaded: 0, total: file.size, percent: 0 }),
      }
      let attempt!: UploadAttempt
      try {
        const storageId = await new Promise<GenericId<'_storage'>>((resolve, reject) => {
          attempt = {
            resolve,
            reject,
            publishProgress(progress) {
              if (active === attempt) state.value = { ...state.value, progress }
            },
            cancel() {
              if (active === attempt) retire(cancelledError(functionName))
              else reject(cancelledError(functionName))
            },
          }
          active = attempt
          if (record.behavior?.state === 'resolved')
            resolve(record.behavior.value as GenericId<'_storage'>)
          else if (record.behavior?.state === 'rejected') reject(record.behavior.value)
          else record.pending.add(attempt)
        })
        // A cancelled or retired attempt cannot overwrite newer state.
        if (active !== attempt) throw retiredReasons.get(attempt) ?? cancelledError(functionName)
        state.value = { status: 'success', data: storageId, progress: state.value.progress }
        return storageId
      } catch (error) {
        if (active !== attempt) throw retiredReasons.get(attempt) ?? cancelledError(functionName)
        const normalized = normalizeConvexError(error, { functionName })
        state.value = { status: 'error', error: normalized, progress: state.value.progress }
        throw normalized
      } finally {
        record.pending.delete(attempt)
        if (active === attempt) active = null
      }
    }

    return Object.freeze({
      upload: run,
      data: computed(() => state.value.data),
      status: computed(() => state.value.status),
      pending: computed(() => state.value.status === 'pending'),
      progress: computed(() => state.value.progress),
      error: computed(() => state.value.error),
      cancel: () => {
        if (active) retire(cancelledError(functionName))
      },
      reset: () => retire(cancelledError(functionName)),
    })
  }

  return { upload, useConvexFileUpload }
}
