import { ConvexCallError } from '../errors'

/**
 * Check whether a MIME type matches one allowed pattern: an exact type
 * (`image/png`) or a top-level wildcard (`image/*`).
 */
export function matchesMimeType(fileType: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    const category = pattern.slice(0, -2)
    return fileType.startsWith(`${category}/`)
  }
  return fileType === pattern
}

/** Whether a MIME type matches any allowed pattern. */
export function isFileTypeAllowed(fileType: string, allowedTypes: readonly string[]): boolean {
  return allowedTypes.some((pattern) => matchesMimeType(fileType, pattern))
}

/** Client-side limits a file must meet before any upload request is made. */
export interface UploadFileLimits {
  readonly maxSize?: number
  readonly allowedTypes?: readonly string[]
}

/**
 * The one client-side upload preflight, shared by `useConvexFileUpload` and
 * `op.upload()`: the `FILE_TOO_LARGE` or `FILE_TYPE_NOT_ALLOWED` failure for
 * `file`, or `undefined` when it meets `limits`. Nothing has been sent, so a
 * failure records `outcome: 'not-sent'`.
 */
export function checkUploadFile(
  file: Blob,
  limits: UploadFileLimits,
  functionName?: string,
): ConvexCallError | undefined {
  const { maxSize, allowedTypes } = limits
  if (maxSize !== undefined && file.size > maxSize) {
    return new ConvexCallError({
      kind: 'unknown',
      code: 'FILE_TOO_LARGE',
      message: `File size ${file.size} bytes exceeds maximum ${maxSize} bytes`,
      functionName,
      outcome: 'not-sent',
    })
  }
  if (allowedTypes && !isFileTypeAllowed(file.type, allowedTypes)) {
    return new ConvexCallError({
      kind: 'unknown',
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: `File type "${file.type}" not allowed. Allowed: ${allowedTypes.join(', ')}`,
      functionName,
      outcome: 'not-sent',
    })
  }
  return undefined
}
