import type { ConvexClient } from 'convex/browser'
import type { FunctionArgs, FunctionReference } from 'convex/server'

import { ConvexCallError } from '../errors'

export interface UploadProgressInfo {
  loaded: number
  total: number
  percent: number
}

export interface UploadFileViaXhrOptions {
  signal?: AbortSignal
  onProgress?: (info: UploadProgressInfo) => void
}

function createAbortError(): Error {
  return new DOMException('Upload cancelled', 'AbortError')
}

export function isUploadAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

// The XHR upload endpoint is a library-owned HTTP boundary (architecture invariant): it
// knows the source, so it constructs `transport` errors directly. Network
// failures, unexpected upstream statuses, and unusable/malformed responses are
// all transport. Cancellation stays a DOMException so the composable can treat
// it as a non-error cancel rather than a call failure.
function createUploadTransportError(
  message: string,
  extra?: { status?: number; code?: string },
): ConvexCallError {
  return new ConvexCallError({
    kind: 'transport',
    message,
    status: extra?.status,
    code: extra?.code,
  })
}

export async function requestUploadUrl<Mutation extends FunctionReference<'mutation'>>(
  // Accepts the replacement-safe `useConvex()` handle , which exposes
  // `mutation` with a stable identity, not only the raw `ConvexClient`.
  client: Pick<ConvexClient, 'mutation'> | null,
  mutation: Mutation,
  mutationArgs: FunctionArgs<Mutation>,
): Promise<string> {
  if (!client) {
    throw new ConvexCallError({
      kind: 'unknown',
      message: 'ConvexClient not available - file uploads only work on client side',
    })
  }

  const postUrl = await client.mutation(mutation, mutationArgs)
  if (typeof postUrl !== 'string') {
    throw new ConvexCallError({
      kind: 'unknown',
      message: 'generateUploadUrl mutation must return a string URL',
    })
  }
  return postUrl
}

export async function executeFileUpload<Mutation extends FunctionReference<'mutation'>>(
  client: Pick<ConvexClient, 'mutation'> | null,
  mutation: Mutation,
  mutationArgs: FunctionArgs<Mutation>,
  file: File,
  options?: UploadFileViaXhrOptions,
): Promise<string> {
  const signal = options?.signal
  let rejectAbort: ((reason: unknown) => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort?.(signal?.reason ?? createAbortError())

  if (signal?.aborted) throw signal.reason ?? createAbortError()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const postUrl = await Promise.race([requestUploadUrl(client, mutation, mutationArgs), aborted])
    return await uploadFileViaXhr(postUrl, file, options)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export function uploadFileViaXhr(
  postUrl: string,
  file: File,
  options?: UploadFileViaXhrOptions,
): Promise<string> {
  const { signal, onProgress } = options ?? {}

  if (signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbortSignal)
      }
    }

    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onAbortSignal = () => {
      try {
        xhr.abort()
      } catch {
        fail(createAbortError())
      }
    }

    if (signal) {
      signal.addEventListener('abort', onAbortSignal, { once: true })
    }

    xhr.open('POST', postUrl)
    if (file.type) {
      xhr.setRequestHeader('Content-Type', file.type)
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const percent = Math.round((event.loaded / event.total) * 100)
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent,
      })
    }

    xhr.onload = () => {
      cleanup()
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText) as { storageId?: unknown }
          if (typeof response?.storageId !== 'string' || response.storageId.length === 0) {
            reject(createUploadTransportError('Upload endpoint response missing valid storageId'))
            return
          }
          resolve(response.storageId)
        } catch {
          reject(createUploadTransportError('Invalid response from upload endpoint'))
        }
      } else {
        reject(
          createUploadTransportError(`Upload failed: ${xhr.status} ${xhr.statusText}`, {
            status: xhr.status,
          }),
        )
      }
    }

    xhr.onerror = () => {
      fail(createUploadTransportError('Network error during upload'))
    }

    xhr.onabort = () => {
      fail(createAbortError())
    }

    xhr.send(file)
  })
}
