/**
 * MIME type matching utilities for file validation.
 * Used by useConvexFileUpload for client-side file type validation.
 */

/**
 * Check if a file type matches an allowed type pattern.
 * Supports exact matches and wildcards (e.g., 'image/*').
 *
 * @param fileType - The MIME type of the file (e.g., 'image/jpeg')
 * @param pattern - The pattern to match against (e.g., 'image/*' or 'image/jpeg')
 * @returns true if the file type matches the pattern
 *
 * @example
 * matchesMimeType('image/jpeg', 'image/jpeg')  // true (exact match)
 * matchesMimeType('image/jpeg', 'image/*')     // true (wildcard)
 * matchesMimeType('image/jpeg', 'video/*')     // false
 * matchesMimeType('video/mp4', 'video/*')      // true
 */
export function matchesMimeType(fileType: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    // Wildcard match: 'image/*' matches 'image/jpeg', 'image/png', etc.
    const category = pattern.slice(0, -2)
    return fileType.startsWith(`${category}/`)
  }
  // Exact match
  return fileType === pattern
}

/**
 * Check if a file type is allowed by any of the allowed type patterns.
 *
 * @param fileType - The MIME type of the file (e.g., 'image/jpeg')
 * @param allowedTypes - Array of allowed patterns (supports wildcards)
 * @returns true if the file type matches any of the allowed patterns
 *
 * @example
 * isFileTypeAllowed('image/jpeg', ['image/jpeg', 'image/png'])  // true
 * isFileTypeAllowed('image/gif', ['image/*'])                   // true
 * isFileTypeAllowed('video/mp4', ['image/*'])                   // false
 * isFileTypeAllowed('application/pdf', ['image/*', 'application/pdf'])  // true
 */
export function isFileTypeAllowed(fileType: string, allowedTypes: readonly string[]): boolean {
  return allowedTypes.some((pattern) => matchesMimeType(fileType, pattern))
}
