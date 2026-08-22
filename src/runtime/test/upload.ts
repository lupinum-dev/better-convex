import type { FunctionArgs, FunctionReference, OptionalRestArgs } from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId } from 'convex/values'
import { computed, shallowRef } from 'vue'

import type {
  UploadProgressInfo,
  UploadUrlMutation,
  UseConvexFileUploadOptions,
  UseConvexFileUploadReturn,
} from '../composables/useConvexFileUpload'
import { ConvexCallError } from '../errors'

export interface BetterConvexTestUploadCall<Mutation extends UploadUrlMutation> {
  readonly file: File
  readonly args: FunctionArgs<Mutation>
}

export interface BetterConvexTestUploadController<Mutation extends UploadUrlMutation> {
  readonly calls: readonly BetterConvexTestUploadCall<Mutation>[]
  resolve(storageId: GenericId<'_storage'>): void
  reject(error: unknown): void
  progress(progress: UploadProgressInfo): void
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
}

interface UploadRecord {
  readonly calls: BetterConvexTestUploadCall<UploadUrlMutation>[]
  readonly pending: Set<UploadAttempt>
  behavior?: UploadBehavior
}

const EMPTY_PROGRESS: UploadProgressInfo = Object.freeze({ loaded: 0, total: 0, percent: 0 })

function progressSnapshot(progress: UploadProgressInfo): UploadProgressInfo {
  return Object.freeze({
    loaded: progress.loaded,
    total: progress.total,
    percent: progress.percent,
  })
}

function normalizedError(error: unknown): ConvexCallError {
  if (error instanceof ConvexCallError) return error
  return new ConvexCallError({
    kind: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  })
}

function typeAllowed(type: string, allowed: readonly string[]): boolean {
  return allowed.some((candidate) =>
    candidate.endsWith('/*') ? type.startsWith(candidate.slice(0, -1)) : candidate === type,
  )
}

export function createBetterConvexTestUploads() {
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
    for (const attempt of record.pending) {
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
        for (const attempt of record.pending) {
          attempt.reject(new Error('Better Convex test upload reset'))
        }
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
    const record = recordFor(mutation)
    const state = shallowRef<{
      status: 'idle' | 'pending' | 'success' | 'error'
      data?: GenericId<'_storage'>
      error?: ConvexCallError
      progress: UploadProgressInfo
    }>({ status: 'idle', progress: EMPTY_PROGRESS })
    let active: UploadAttempt | null = null

    const run = async (
      file: File,
      ...args: OptionalRestArgs<Mutation>
    ): Promise<GenericId<'_storage'>> => {
      if (state.value.status === 'pending') {
        throw normalizedError(new Error('Upload already in progress for this composable instance'))
      }
      if (options.maxSize !== undefined && file.size > options.maxSize) {
        const error = normalizedError(
          new Error(`File size exceeds maximum of ${options.maxSize} bytes`),
        )
        state.value = { status: 'error', error, progress: EMPTY_PROGRESS }
        throw error
      }
      if (options.allowedTypes && !typeAllowed(file.type, options.allowedTypes)) {
        const error = normalizedError(new Error(`File type "${file.type}" is not allowed`))
        state.value = { status: 'error', error, progress: EMPTY_PROGRESS }
        throw error
      }

      record.calls.push({ file, args: (args[0] ?? {}) as FunctionArgs<Mutation> })
      state.value = { status: 'pending', progress: EMPTY_PROGRESS }
      let attempt!: UploadAttempt
      try {
        const storageId = await new Promise<GenericId<'_storage'>>((resolve, reject) => {
          attempt = {
            resolve,
            reject,
            publishProgress(progress) {
              if (active === attempt) state.value = { ...state.value, progress }
            },
          }
          active = attempt
          if (record.behavior?.state === 'resolved')
            resolve(record.behavior.value as GenericId<'_storage'>)
          else if (record.behavior?.state === 'rejected') reject(record.behavior.value)
          else record.pending.add(attempt)
        })
        state.value = { status: 'success', data: storageId, progress: state.value.progress }
        return storageId
      } catch (error) {
        // A cancelled attempt, or an older attempt replaced after cancellation,
        // must not overwrite the current composable state.
        if (active !== attempt) throw error
        const normalized = normalizedError(error)
        state.value = { status: 'error', error: normalized, progress: state.value.progress }
        throw normalized
      } finally {
        record.pending.delete(attempt)
        if (active === attempt) active = null
      }
    }

    const cancel = () => {
      const attempt = active
      active = null
      if (attempt) {
        record.pending.delete(attempt)
        attempt.reject(new DOMException('Upload cancelled', 'AbortError'))
      }
      state.value = { status: 'idle', progress: EMPTY_PROGRESS }
    }

    return Object.freeze({
      upload: run,
      data: computed(() => state.value.data),
      status: computed(() => state.value.status),
      pending: computed(() => state.value.status === 'pending'),
      progress: computed(() => state.value.progress),
      error: computed(() => state.value.error),
      cancel,
    })
  }

  return { upload, useConvexFileUpload }
}
