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
