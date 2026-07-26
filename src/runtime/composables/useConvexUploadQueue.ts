import type { FunctionArgs, FunctionReference } from 'convex/server'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue'

import { useNuxtApp } from '#imports'

import { ConvexCallError, normalizeConvexError, type CallResult } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import { assertConvexComposableScope } from '../utils/composable-scope'
import { normalizeMaxConcurrent } from '../utils/config-defaults'
import { getFunctionName } from '../utils/convex-shared'
import { createIdentityChangedError, isIdentityChangedError } from '../utils/identity-changed-error'
import { createLogger } from '../utils/logger'
import { getConvexRuntimeConfig } from '../utils/runtime-config'
import { executeFileUpload, isUploadAbortError } from '../utils/upload-core'
import {
  computeUploadQueueAggregateProgress,
  countUploadQueueItems,
  normalizeUploadQueueEnqueueInput,
  type UploadQueueItem,
  type UploadQueueEnqueueInput,
} from '../utils/upload-queue-state'
import { useConvex } from './useConvex'

export type {
  UploadQueueEnqueueInput,
  UploadQueueEnqueueItem,
  UploadQueueItem,
  UploadQueueItemStatus,
} from '../utils/upload-queue-state'

type QueueCallbackItem<Mutation extends FunctionReference<'mutation'>> = Readonly<
  UploadQueueItem<FunctionArgs<Mutation>>
>

export interface UseConvexUploadQueueOptions<Mutation extends FunctionReference<'mutation'>> {
  maxConcurrent?: number
  continueOnError?: boolean
  onItemSuccess?: (item: QueueCallbackItem<Mutation>) => void
  onItemError?: (item: QueueCallbackItem<Mutation>) => void
  onQueueIdle?: (items: readonly QueueCallbackItem<Mutation>[]) => void
}

function createUploadQueueError(message: string): ConvexCallError {
  return new ConvexCallError({ kind: 'unknown', message })
}

export interface UseConvexUploadQueueReturn<Mutation extends FunctionReference<'mutation'>> {
  items: Readonly<Ref<readonly QueueCallbackItem<Mutation>[]>>
  isRunning: ComputedRef<boolean>
  hasErrors: ComputedRef<boolean>
  queuedCount: ComputedRef<number>
  pendingCount: ComputedRef<number>
  successCount: ComputedRef<number>
  errorCount: ComputedRef<number>
  cancelledCount: ComputedRef<number>
  aggregateProgress: ComputedRef<number>
  enqueue: (
    input: UploadQueueEnqueueInput<FunctionArgs<Mutation>>,
    mutationArgs?: FunctionArgs<Mutation>,
  ) => Promise<string[]>
  enqueueSafe: (
    input: UploadQueueEnqueueInput<FunctionArgs<Mutation>>,
    mutationArgs?: FunctionArgs<Mutation>,
  ) => Promise<CallResult<string[]>>
  cancelItem: (id: string) => void
  cancelAll: () => void
  clearFinished: () => void
  reset: () => void
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

interface UploadQueueRuntime {
  controller: AbortController | null
  deferred: Deferred<string>
  identityGeneration: number
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function useConvexUploadQueue<Mutation extends FunctionReference<'mutation'>>(
  generateUploadUrlMutation: Mutation,
  options?: UseConvexUploadQueueOptions<Mutation>,
): UseConvexUploadQueueReturn<Mutation> {
  type MutationArgs = FunctionArgs<Mutation>
  type QueueItem = UploadQueueItem<MutationArgs>

  const currentScope = getCurrentScope()
  assertConvexComposableScope('useConvexUploadQueue', import.meta.client, currentScope)
  const nuxtApp = useNuxtApp()
  const runtime = readConvexRuntimeContext(nuxtApp)
  const identityObserver = runtime?.attachment.identity
  const getIdentityGeneration = () => identityObserver?.snapshot().identityGeneration ?? 0
  const convexConfig = getConvexRuntimeConfig()
  const client = useConvex()
  const fnName = getFunctionName(generateUploadUrlMutation)
  const logger = runtime?.logger ?? createLogger(convexConfig.logging)

  const maxConcurrent = normalizeMaxConcurrent(
    options?.maxConcurrent ?? convexConfig.upload.maxConcurrent,
  )
  const continueOnError = options?.continueOnError ?? true

  const items = ref<QueueItem[]>([])
  const readonlyItems = readonly(items) as Readonly<Ref<readonly Readonly<QueueItem>[]>>
  const runtimeById = new Map<string, UploadQueueRuntime>()
  let queueItemSequence = 0
  let scheduling = false
  let hasBeenBusy = false
  let observedIdentityGeneration = getIdentityGeneration()

  const createQueueItemId = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    queueItemSequence += 1
    return `upload-item-${Date.now()}-${queueItemSequence}`
  }

  const queuedCount = computed(() => countUploadQueueItems(items.value, 'queued'))
  const pendingCount = computed(() => countUploadQueueItems(items.value, 'pending'))
  const successCount = computed(() => countUploadQueueItems(items.value, 'success'))
  const errorCount = computed(() => countUploadQueueItems(items.value, 'error'))
  const cancelledCount = computed(() => countUploadQueueItems(items.value, 'cancelled'))

  const isRunning = computed(() => pendingCount.value > 0 || queuedCount.value > 0)

  const hasErrors = computed(() => errorCount.value > 0)

  const aggregateProgress = computed(() => computeUploadQueueAggregateProgress(items.value))

  const mutateItem = (id: string, updater: (item: QueueItem) => QueueItem): QueueItem | null => {
    let updated: QueueItem | null = null
    items.value = items.value.map((item) => {
      if (item.id !== id) return item
      updated = updater(item)
      return updated
    })
    return updated
  }

  const snapshotItem = (item: QueueItem): Readonly<QueueItem> => ({ ...item })
  const invokeCallback = (callback: (() => void) | undefined, item?: QueueItem) => {
    if (!callback) return
    try {
      callback()
    } catch (error) {
      logger.upload({
        name: fnName,
        event: 'error',
        filename: item?.file.name,
        size: item?.file.size,
        error,
      })
    }
  }

  const maybeEmitQueueIdle = () => {
    if (isRunning.value) {
      hasBeenBusy = true
      return
    }

    if (!hasBeenBusy) return
    hasBeenBusy = false
    invokeCallback(() => options?.onQueueIdle?.(items.value.map(snapshotItem)))
  }

  const rejectItemDeferred = (id: string, error: unknown) => {
    const runtime = runtimeById.get(id)
    if (!runtime) return
    runtimeById.delete(id)
    runtime.deferred.reject(error)
  }

  const cancelQueued = (error: ConvexCallError) => {
    if (!items.value.some((item) => item.status === 'queued')) return
    const now = Date.now()
    items.value = items.value.map((item) => {
      if (item.status !== 'queued') return item
      rejectItemDeferred(item.id, error)
      return { ...item, status: 'cancelled', finishedAt: now }
    })
  }

  const clearQueue = (error: ConvexCallError) => {
    const runtimes = [...runtimeById.values()]
    runtimeById.clear()
    items.value = []
    for (const runtime of runtimes) {
      runtime.deferred.reject(error)
      runtime.controller?.abort()
    }
  }

  const retireIdentityOwnedState = () => {
    hasBeenBusy = false
    clearQueue(createIdentityChangedError('upload queue'))
  }

  const runItem = async (itemId: string): Promise<void> => {
    const itemRuntime = runtimeById.get(itemId)
    if (!itemRuntime) return
    const identityGeneration = itemRuntime.identityGeneration
    const controller = new AbortController()
    itemRuntime.controller = controller
    const identityChanged = () => getIdentityGeneration() !== identityGeneration
    const isCurrentItem = () =>
      runtimeById.get(itemId) === itemRuntime && !identityChanged() && !controller.signal.aborted
    const requireCurrentItem = () => {
      if (identityChanged()) throw createIdentityChangedError('upload queue')
      if (!isCurrentItem()) throw new DOMException('Upload cancelled', 'AbortError')
    }
    const mutateCurrentItem = (updater: (item: QueueItem) => QueueItem): QueueItem | null => {
      requireCurrentItem()
      const updated = mutateItem(itemId, updater)
      requireCurrentItem()
      return updated
    }
    const retireIfStale = (): boolean => {
      if (!identityChanged()) return runtimeById.get(itemId) !== itemRuntime
      if (runtimeById.get(itemId) === itemRuntime) retireIdentityOwnedState()
      return true
    }

    try {
      mutateCurrentItem((item) => ({
        ...item,
        status: 'pending',
        startedAt: Date.now(),
        error: null,
      }))

      const item = items.value.find((entry) => entry.id === itemId)
      if (!item) {
        rejectItemDeferred(itemId, createUploadQueueError('Upload item no longer exists'))
        return
      }

      const storageId = await executeFileUpload(
        client,
        generateUploadUrlMutation,
        (item.mutationArgs ?? {}) as MutationArgs,
        item.file,
        {
          signal: controller.signal,
          onProgress: (progressInfo) => {
            if (!isCurrentItem()) return
            mutateItem(itemId, (current) => ({
              ...current,
              progress: progressInfo.percent,
              loadedBytes: progressInfo.loaded,
              totalBytes: progressInfo.total > 0 ? progressInfo.total : current.totalBytes,
            }))
          },
        },
      )

      // The upload is complete before success becomes observable. Keep the
      // deferred live until publication so an identity change or reset can still
      // retire it, but make public cancellation unable to abort completed work.
      requireCurrentItem()
      itemRuntime.controller = null
      const successItem = mutateItem(itemId, (current) => ({
        ...current,
        status: 'success',
        storageId,
        progress: 100,
        loadedBytes: current.totalBytes,
        error: null,
        finishedAt: Date.now(),
      }))
      if (identityChanged()) {
        if (runtimeById.get(itemId) === itemRuntime) retireIdentityOwnedState()
        return
      }
      if (runtimeById.get(itemId) !== itemRuntime) return
      runtimeById.delete(itemId)
      itemRuntime.deferred.resolve(storageId)
      if (successItem) {
        invokeCallback(() => options?.onItemSuccess?.(snapshotItem(successItem)), successItem)
      }
      if (identityChanged()) retireIdentityOwnedState()
    } catch (error) {
      if (identityChanged() || isIdentityChangedError(error)) {
        if (runtimeById.get(itemId) === itemRuntime) {
          retireIdentityOwnedState()
        }
        return
      }
      const now = Date.now()
      if (isUploadAbortError(error)) {
        mutateItem(itemId, (current) => ({
          ...current,
          status: 'cancelled',
          error: null,
          finishedAt: now,
        }))
        rejectItemDeferred(itemId, createUploadQueueError('Upload cancelled'))
      } else {
        const normalizedError = normalizeConvexError(error)
        const erroredItem = mutateItem(itemId, (current) => ({
          ...current,
          status: 'error',
          error: normalizedError,
          finishedAt: now,
        }))
        if (retireIfStale()) return
        if (erroredItem) {
          invokeCallback(() => options?.onItemError?.(snapshotItem(erroredItem)), erroredItem)
        }
        if (retireIfStale()) return

        if (!continueOnError) {
          cancelQueued(createUploadQueueError('Upload queue halted after an upload error'))
          if (retireIfStale()) return
        }
        rejectItemDeferred(itemId, normalizedError)
      }
    } finally {
      const runtime = runtimeById.get(itemId)
      if (runtime === itemRuntime) runtime.controller = null
      schedule()
      maybeEmitQueueIdle()
    }
  }

  const schedule = (): void => {
    if (scheduling) return
    scheduling = true

    try {
      while (pendingCount.value < maxConcurrent) {
        const nextQueued = items.value.find((item) => item.status === 'queued')
        if (!nextQueued) break
        void runItem(nextQueued.id)
      }
    } finally {
      scheduling = false
      maybeEmitQueueIdle()
    }
  }

  const enqueue = async (
    input: UploadQueueEnqueueInput<MutationArgs>,
    mutationArgs?: MutationArgs,
  ): Promise<string[]> => {
    const entries = normalizeUploadQueueEnqueueInput(input, mutationArgs)
    if (entries.length === 0) return []
    const identityGeneration = getIdentityGeneration()

    const now = Date.now()
    const newItems: QueueItem[] = entries.map((entry) => ({
      id: createQueueItemId(),
      file: entry.file,
      mutationArgs: entry.mutationArgs,
      status: 'queued',
      progress: 0,
      loadedBytes: 0,
      totalBytes: entry.file.size,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    }))

    const deferreds = newItems.map((item) => {
      const deferred = createDeferred<string>()
      runtimeById.set(item.id, { controller: null, deferred, identityGeneration })
      return deferred.promise
    })
    items.value = [...items.value, ...newItems]
    schedule()

    const settled = await Promise.allSettled(deferreds)
    if (getIdentityGeneration() !== identityGeneration) {
      throw createIdentityChangedError('upload queue')
    }

    const storageIds: string[] = []
    const failures: ConvexCallError[] = []

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        storageIds.push(result.value)
      } else {
        const failure = normalizeConvexError(result.reason)
        if (isIdentityChangedError(failure)) throw failure
        failures.push(failure)
      }
    }

    if (failures.length > 0) {
      if (failures.length === 1) {
        throw failures[0]
      }
      throw new AggregateError(failures, `${failures.length} uploads failed`)
    }

    return storageIds
  }

  const enqueueSafe = async (
    input: UploadQueueEnqueueInput<MutationArgs>,
    mutationArgs?: MutationArgs,
  ): Promise<CallResult<string[]>> => {
    try {
      return { ok: true, data: await enqueue(input, mutationArgs) }
    } catch (error) {
      return { ok: false, error: normalizeConvexError(error) }
    }
  }

  const cancelItem = (id: string): void => {
    const item = items.value.find((entry) => entry.id === id)
    if (!item || (item.status !== 'queued' && item.status !== 'pending')) return
    const runtime = runtimeById.get(id)
    if (item.status === 'pending' && runtime?.controller) {
      runtime.controller.abort()
      return
    }

    mutateItem(id, (item) => {
      if (item.status !== 'queued') return item
      rejectItemDeferred(id, createUploadQueueError('Upload cancelled'))
      return {
        ...item,
        status: 'cancelled',
        finishedAt: Date.now(),
      }
    })

    schedule()
    maybeEmitQueueIdle()
  }

  const cancelAll = (): void => {
    const cancellableIds = new Set(
      items.value
        .filter((item) => item.status === 'queued' || item.status === 'pending')
        .map((item) => item.id),
    )
    const runtimes = [...runtimeById.entries()]
      .filter(([id]) => cancellableIds.has(id))
      .map(([, runtime]) => runtime)
    cancelQueued(createUploadQueueError('Upload cancelled'))

    for (const runtime of runtimes) {
      runtime.controller?.abort()
    }
    maybeEmitQueueIdle()
  }

  const clearFinished = (): void => {
    items.value = items.value.filter(
      (item) => item.status !== 'success' && item.status !== 'error' && item.status !== 'cancelled',
    )
  }

  const reset = (): void => {
    clearQueue(createUploadQueueError('Upload queue was reset'))
    maybeEmitQueueIdle()
  }

  if (currentScope) {
    const stopIdentitySubscription = identityObserver?.subscribe(() => {
      const generation = getIdentityGeneration()
      if (generation === observedIdentityGeneration) return
      observedIdentityGeneration = generation
      retireIdentityOwnedState()
    })
    onScopeDispose(() => {
      stopIdentitySubscription?.()
      reset()
    })
  }

  return {
    items: readonlyItems,
    isRunning,
    hasErrors,
    queuedCount,
    pendingCount,
    successCount,
    errorCount,
    cancelledCount,
    aggregateProgress,
    enqueue,
    enqueueSafe,
    cancelItem,
    cancelAll,
    clearFinished,
    reset,
  }
}
