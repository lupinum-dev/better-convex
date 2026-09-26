import type { FunctionArgs, FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'
import { shallowRef, type ShallowRef } from 'vue'

import { ConvexCallError, normalizeConvexError, type ConvexCallErrorCode } from '../errors'
import type { ClientCallStatus } from './call-state'
import type { ConvexClientHandle } from './client-owner'
import { createIdentityChangedError, isIdentityChangedError } from './identity-changed-error'
import { uploadToConvexStorage, type UploadProgressInfo } from './upload-transport'
import { isFileTypeAllowed } from './upload-validation'

export interface FileUploadViewState {
  readonly status: ClientCallStatus
  readonly error: ConvexCallError | undefined
  readonly data: GenericId<'_storage'> | undefined
  readonly progress: UploadProgressInfo
}

const EMPTY_PROGRESS: UploadProgressInfo = Object.freeze({ loaded: 0, total: 0, percent: 0 })
const IDLE_STATE: FileUploadViewState = Object.freeze({
  status: 'idle',
  error: undefined,
  data: undefined,
  progress: EMPTY_PROGRESS,
})

/** Package-private observation seam; Nuxt feeds its logger from it. */
export interface ConvexFileUploadObserver {
  succeeded(event: { readonly file: File; readonly durationMs: number }): void
  failed(event: {
    readonly file: File
    readonly error: ConvexCallError
    readonly durationMs?: number
  }): void
}

export interface FileUploadControllerInput<Mutation extends FunctionReference<'mutation'>> {
  readonly mutation: Mutation
  readonly functionName: string
  readonly maxSize?: number
  readonly allowedTypes?: readonly string[]
  /** `null` when no browser Convex client exists, for example during SSR. */
  readonly client: Pick<ConvexClientHandle, 'mutation'> | null
  getIdentityGeneration(): number
  subscribeIdentityChange?(listener: () => void): () => void
  readonly observer?: ConvexFileUploadObserver
}

export interface FileUploadController<Mutation extends FunctionReference<'mutation'>> {
  readonly state: Readonly<ShallowRef<FileUploadViewState>>
  upload(file: File, args: FunctionArgs<Mutation>): Promise<GenericId<'_storage'>>
  cancel(): void
  reset(): void
  dispose(): void
}

/**
 * The one single-file upload lifecycle.
 *
 * An upload is bound to the identity generation visible when it starts. An
 * identity change retires in-flight and finished state synchronously and
 * rejects the in-flight upload with `IDENTITY_CHANGED`. `cancel()`, `reset()`,
 * and disposal reject it with `CANCELLED` and return to `idle`, never `error`.
 * Each state transition is one atomic snapshot, so a synchronous watcher never
 * observes (or re-enters through) a half-cleared state.
 */
export function createFileUploadController<Mutation extends FunctionReference<'mutation'>>(
  input: FileUploadControllerInput<Mutation>,
): FileUploadController<Mutation> {
  const { functionName, getIdentityGeneration } = input
  const errorContext = { functionName }
  const state = shallowRef<FileUploadViewState>(IDLE_STATE)
  let currentAttempt: AbortController | null = null
  let observedGeneration = getIdentityGeneration()
  let disposed = false

  const libraryError = (code: ConvexCallErrorCode, message: string) =>
    new ConvexCallError({ kind: 'unknown', code, message, functionName })
  const cancelledError = () =>
    libraryError('CANCELLED', 'Convex upload cancelled before it settled.')
  const identityChangedError = () => createIdentityChangedError('upload', errorContext)

  const report = (callback: () => void) => {
    try {
      callback()
    } catch {
      // Diagnostics are non-authoritative and cannot replace the outcome.
    }
  }

  /** Publish idle, then abort the attempt that was current before publishing. */
  const retire = (reason: ConvexCallError) => {
    // Snapshot first: a synchronous watcher may start a fresh upload while the
    // idle state publishes, and only this attempt may be retired here.
    const attempt = currentAttempt
    state.value = IDLE_STATE
    if (currentAttempt === attempt) currentAttempt = null
    attempt?.abort(reason)
  }

  const stopIdentity =
    input.subscribeIdentityChange?.(() => {
      const generation = getIdentityGeneration()
      if (generation === observedGeneration) return
      observedGeneration = generation
      retire(identityChangedError())
    }) ?? null

  const upload = async (
    file: File,
    args: FunctionArgs<Mutation>,
  ): Promise<GenericId<'_storage'>> => {
    const startedAt = Date.now()
    if (disposed) throw cancelledError()
    // The published state is the synchronous concurrency guard, including the
    // upload-URL phase before the XHR begins.
    if (state.value.status === 'pending') {
      const error = libraryError(
        'UPLOAD_IN_PROGRESS',
        'An upload is already in progress for this composable.',
      )
      report(() => input.observer?.failed({ file, error }))
      throw error
    }

    const generation = getIdentityGeneration()
    const identityChanged = () => getIdentityGeneration() !== generation
    const requireCurrentIdentity = () => {
      if (identityChanged()) throw identityChangedError()
    }
    // A same-identity watcher may start fresh work while a terminal state
    // publishes; only an identity change invalidates this settled result.
    const publishTerminal = (next: FileUploadViewState) => {
      requireCurrentIdentity()
      state.value = next
      requireCurrentIdentity()
    }
    const publishFailure = (error: ConvexCallError, progress = EMPTY_PROGRESS) => {
      publishTerminal({ status: 'error', error, data: undefined, progress })
      report(() => input.observer?.failed({ file, error, durationMs: Date.now() - startedAt }))
      requireCurrentIdentity()
      return error
    }

    // Client-side validation never reaches the network.
    if (input.maxSize !== undefined && file.size > input.maxSize) {
      throw publishFailure(
        libraryError(
          'FILE_TOO_LARGE',
          `File size ${file.size} bytes exceeds maximum ${input.maxSize} bytes`,
        ),
      )
    }
    if (input.allowedTypes && !isFileTypeAllowed(file.type, input.allowedTypes)) {
      throw publishFailure(
        libraryError(
          'FILE_TYPE_NOT_ALLOWED',
          `File type "${file.type}" not allowed. Allowed: ${input.allowedTypes.join(', ')}`,
        ),
      )
    }
    // The storage POST needs XHR for byte progress; a server has neither it
    // nor a browser Convex client.
    const client = typeof XMLHttpRequest === 'function' ? input.client : null
    if (!client) {
      throw publishFailure(
        libraryError(
          'CLIENT_UNAVAILABLE',
          'No browser Convex client is available. Upload files from the browser.',
        ),
      )
    }

    const attempt = new AbortController()
    currentAttempt = attempt
    const isCurrent = () =>
      currentAttempt === attempt && !identityChanged() && !attempt.signal.aborted
    const retiredReason = (): ConvexCallError =>
      attempt.signal.reason instanceof ConvexCallError ? attempt.signal.reason : cancelledError()
    const requireCurrent = () => {
      requireCurrentIdentity()
      if (!isCurrent()) throw retiredReason()
    }

    try {
      state.value = {
        status: 'pending',
        error: undefined,
        data: undefined,
        progress: { loaded: 0, total: file.size, percent: 0 },
      }
      requireCurrent()

      const storageId = await uploadToConvexStorage(client, input.mutation, args, file, {
        signal: attempt.signal,
        onProgress: (progress) => {
          if (isCurrent()) state.value = { ...state.value, progress }
        },
      })

      requireCurrent()
      publishTerminal({ ...state.value, status: 'success', data: storageId })
      report(() => input.observer?.succeeded({ file, durationMs: Date.now() - startedAt }))
      requireCurrentIdentity()
      return storageId
    } catch (cause) {
      if (identityChanged() || isIdentityChangedError(cause)) {
        if (currentAttempt === attempt) retire(identityChangedError())
        throw isIdentityChangedError(cause) ? cause : identityChangedError()
      }
      if (currentAttempt !== attempt || attempt.signal.aborted) throw retiredReason()
      throw publishFailure(normalizeConvexError(cause, errorContext), state.value.progress)
    } finally {
      if (currentAttempt === attempt) currentAttempt = null
    }
  }

  return {
    state,
    upload,
    cancel() {
      if (currentAttempt) retire(cancelledError())
    },
    reset() {
      retire(cancelledError())
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopIdentity?.()
      retire(cancelledError())
    },
  }
}
