import type { FunctionArgs, FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'

import { ConvexCallError, type ConvexCallErrorCode } from '../errors'
import type { ConvexClientHandle } from './client-owner'

export interface UploadProgressInfo {
  readonly loaded: number
  readonly total: number
  readonly percent: number
}

export interface UploadTransportOptions {
  /** Aborting rejects the upload with `signal.reason`. */
  readonly signal: AbortSignal
  readonly onProgress: (info: UploadProgressInfo) => void
}

// The storage endpoint is a library-owned HTTP boundary, so it classifies its
// own failures as `transport`. Messages never include the upload URL: Convex
// upload URLs carry a short-lived token.
function transportError(
  code: ConvexCallErrorCode,
  message: string,
  status?: number,
): ConvexCallError {
  return new ConvexCallError({ kind: 'transport', code, message, status })
}

async function requestUploadUrl<Mutation extends FunctionReference<'mutation'>>(
  client: Pick<ConvexClientHandle, 'mutation'>,
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<string> {
  const postUrl: unknown = await client.mutation(mutation, args)
  if (typeof postUrl !== 'string') {
    throw new ConvexCallError({
      kind: 'unknown',
      code: 'INVALID_UPLOAD_URL' satisfies ConvexCallErrorCode,
      message: 'generateUploadUrl mutation must return a string URL',
    })
  }
  return postUrl
}

/**
 * Upload one file to Convex storage: request an upload URL through the
 * mutation, then POST the file with XHR so byte progress is observable.
 */
export async function uploadToConvexStorage<Mutation extends FunctionReference<'mutation'>>(
  client: Pick<ConvexClientHandle, 'mutation'>,
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
  file: File,
  options: UploadTransportOptions,
): Promise<GenericId<'_storage'>> {
  const { signal } = options
  if (signal.aborted) throw signal.reason
  let stopAbort = () => {}
  // `Promise.race` attaches a handler, so a later abort is never unhandled.
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    stopAbort = () => signal.removeEventListener('abort', onAbort)
  })
  try {
    const postUrl = await Promise.race([requestUploadUrl(client, mutation, args), aborted])
    return await postFile(postUrl, file, options)
  } finally {
    stopAbort()
  }
}

function postFile(
  postUrl: string,
  file: File,
  { signal, onProgress }: UploadTransportOptions,
): Promise<GenericId<'_storage'>> {
  if (signal.aborted) return Promise.reject(signal.reason)

  return new Promise<GenericId<'_storage'>>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    function fail(error: unknown) {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    }
    function onAbort() {
      try {
        xhr.abort()
      } catch {
        fail(signal.reason)
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })

    xhr.open('POST', postUrl)
    if (file.type) xhr.setRequestHeader('Content-Type', file.type)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    }
    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort)
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          transportError(
            'UPSTREAM_ERROR',
            `Upload failed: ${xhr.status} ${xhr.statusText}`,
            xhr.status,
          ),
        )
        return
      }
      let storageId: unknown
      try {
        storageId = (JSON.parse(xhr.responseText) as { storageId?: unknown } | null)?.storageId
      } catch {
        reject(transportError('INVALID_RESPONSE', 'Invalid response from upload endpoint'))
        return
      }
      if (typeof storageId !== 'string' || storageId.length === 0) {
        reject(
          transportError('INVALID_RESPONSE', 'Upload endpoint response missing valid storageId'),
        )
        return
      }
      resolve(storageId as GenericId<'_storage'>)
    }
    xhr.onerror = () => fail(transportError('NETWORK_ERROR', 'Network error during upload'))
    xhr.onabort = () => fail(signal.reason)
    xhr.send(file)
  })
}
