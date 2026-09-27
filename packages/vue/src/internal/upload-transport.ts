import type { GenericId } from 'convex/values'

import { ConvexCallError, type ConvexCallErrorCode, type ConvexCallOutcome } from '../errors'

export interface UploadProgressInfo {
  readonly loaded: number
  readonly total: number
  readonly percent: number
}

export interface UploadTransportOptions {
  /** Aborting rejects the upload with `signal.reason`. */
  readonly signal: AbortSignal
  readonly onProgress?: (info: UploadProgressInfo) => void
}

// The storage endpoint is a library-owned HTTP boundary, so it classifies its
// own failures as `transport`. Messages never include the upload URL: Convex
// upload URLs carry a short-lived token.
function transportError(
  code: ConvexCallErrorCode,
  message: string,
  input: { status?: number; outcome?: ConvexCallOutcome } = {},
): ConvexCallError {
  return new ConvexCallError({ kind: 'transport', code, message, ...input })
}

/** True where the storage POST can run: it needs XHR for byte progress. */
export function canPostFiles(): boolean {
  return typeof XMLHttpRequest === 'function'
}

/**
 * POST one file to a Convex storage upload URL with XHR, so byte progress is
 * observable, and resolve with the storage ID.
 *
 * Failures record their dispatch outcome: an unusable URL is `not-sent`; a
 * network failure or an unusable success body is `unknown` (the file may be
 * stored); a failure status is the endpoint's confirmed answer.
 */
export function postFileToConvexStorage(
  postUrl: string,
  file: Blob,
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

    try {
      xhr.open('POST', postUrl)
      if (file.type) xhr.setRequestHeader('Content-Type', file.type)
    } catch {
      reject(
        transportError('INVALID_UPLOAD_URL', 'The upload URL is not a valid URL', {
          outcome: 'not-sent',
        }),
      )
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      })
    }
    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort)
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          transportError('UPSTREAM_ERROR', `Upload failed: ${xhr.status} ${xhr.statusText}`, {
            status: xhr.status,
          }),
        )
        return
      }
      let storageId: unknown
      try {
        storageId = (JSON.parse(xhr.responseText) as { storageId?: unknown } | null)?.storageId
      } catch {
        reject(
          transportError('INVALID_RESPONSE', 'Invalid response from upload endpoint', {
            outcome: 'unknown',
          }),
        )
        return
      }
      if (typeof storageId !== 'string' || storageId.length === 0) {
        reject(
          transportError('INVALID_RESPONSE', 'Upload endpoint response missing valid storageId', {
            outcome: 'unknown',
          }),
        )
        return
      }
      resolve(storageId as GenericId<'_storage'>)
    }
    xhr.onerror = () =>
      fail(transportError('NETWORK_ERROR', 'Network error during upload', { outcome: 'unknown' }))
    xhr.onabort = () => fail(signal.reason)
    xhr.send(file)
  })
}
