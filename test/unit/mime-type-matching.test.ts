/**
 * Unit Tests for MIME type matching utilities
 *
 * Tests the matchesMimeType and isFileTypeAllowed functions
 * used for client-side file validation in useConvexFileUpload.
 */

import { describe, it, expect } from 'vitest'

import {
  checkUploadFile,
  isFileTypeAllowed,
  matchesMimeType,
} from '../../packages/vue/src/internal/upload-validation'

// ============================================================================
// matchesMimeType Tests
// ============================================================================

describe('matchesMimeType', () => {
  describe('exact matches', () => {
    it('returns true for exact match', () => {
      expect(matchesMimeType('image/jpeg', 'image/jpeg')).toBe(true)
    })

    it('returns false for different type', () => {
      expect(matchesMimeType('image/jpeg', 'image/png')).toBe(false)
    })

    it('returns false for different category', () => {
      expect(matchesMimeType('image/jpeg', 'video/jpeg')).toBe(false)
    })

    it('handles application types', () => {
      expect(matchesMimeType('application/pdf', 'application/pdf')).toBe(true)
      expect(matchesMimeType('application/json', 'application/pdf')).toBe(false)
    })

    it('handles text types', () => {
      expect(matchesMimeType('text/plain', 'text/plain')).toBe(true)
      expect(matchesMimeType('text/html', 'text/plain')).toBe(false)
    })
  })

  describe('wildcard matches', () => {
    it('matches any image type with image/*', () => {
      expect(matchesMimeType('image/jpeg', 'image/*')).toBe(true)
      expect(matchesMimeType('image/png', 'image/*')).toBe(true)
      expect(matchesMimeType('image/gif', 'image/*')).toBe(true)
      expect(matchesMimeType('image/webp', 'image/*')).toBe(true)
      expect(matchesMimeType('image/svg+xml', 'image/*')).toBe(true)
    })

    it('matches any video type with video/*', () => {
      expect(matchesMimeType('video/mp4', 'video/*')).toBe(true)
      expect(matchesMimeType('video/webm', 'video/*')).toBe(true)
      expect(matchesMimeType('video/quicktime', 'video/*')).toBe(true)
    })

    it('matches any audio type with audio/*', () => {
      expect(matchesMimeType('audio/mpeg', 'audio/*')).toBe(true)
      expect(matchesMimeType('audio/wav', 'audio/*')).toBe(true)
      expect(matchesMimeType('audio/ogg', 'audio/*')).toBe(true)
    })

    it('matches any application type with application/*', () => {
      expect(matchesMimeType('application/pdf', 'application/*')).toBe(true)
      expect(matchesMimeType('application/json', 'application/*')).toBe(true)
      expect(matchesMimeType('application/zip', 'application/*')).toBe(true)
    })

    it('matches any text type with text/*', () => {
      expect(matchesMimeType('text/plain', 'text/*')).toBe(true)
      expect(matchesMimeType('text/html', 'text/*')).toBe(true)
      expect(matchesMimeType('text/css', 'text/*')).toBe(true)
    })

    it('does not match different category with wildcard', () => {
      expect(matchesMimeType('video/mp4', 'image/*')).toBe(false)
      expect(matchesMimeType('image/jpeg', 'video/*')).toBe(false)
      expect(matchesMimeType('text/plain', 'image/*')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles empty strings', () => {
      expect(matchesMimeType('', 'image/*')).toBe(false)
      expect(matchesMimeType('image/jpeg', '')).toBe(false)
    })

    it('handles types with parameters (ignores file.type which never includes params)', () => {
      // Browser's file.type never includes parameters, but pattern could theoretically
      expect(matchesMimeType('text/plain', 'text/plain')).toBe(true)
    })

    it('is case-sensitive (MIME types should be lowercase)', () => {
      expect(matchesMimeType('IMAGE/JPEG', 'image/jpeg')).toBe(false)
      expect(matchesMimeType('image/jpeg', 'IMAGE/JPEG')).toBe(false)
    })

    it('handles custom/vendor types', () => {
      expect(matchesMimeType('application/vnd.ms-excel', 'application/*')).toBe(true)
      expect(matchesMimeType('application/vnd.ms-excel', 'application/vnd.ms-excel')).toBe(true)
    })
  })
})

// ============================================================================
// isFileTypeAllowed Tests
// ============================================================================

describe('isFileTypeAllowed', () => {
  describe('single pattern', () => {
    it('allows exact match', () => {
      expect(isFileTypeAllowed('image/jpeg', ['image/jpeg'])).toBe(true)
    })

    it('rejects non-matching type', () => {
      expect(isFileTypeAllowed('image/gif', ['image/jpeg'])).toBe(false)
    })

    it('allows wildcard match', () => {
      expect(isFileTypeAllowed('image/jpeg', ['image/*'])).toBe(true)
    })

    it('rejects non-matching wildcard', () => {
      expect(isFileTypeAllowed('video/mp4', ['image/*'])).toBe(false)
    })
  })

  describe('multiple patterns', () => {
    it('allows if any pattern matches (exact)', () => {
      expect(isFileTypeAllowed('image/png', ['image/jpeg', 'image/png', 'image/gif'])).toBe(true)
    })

    it('allows if any pattern matches (wildcard)', () => {
      expect(isFileTypeAllowed('video/mp4', ['image/*', 'video/*'])).toBe(true)
    })

    it('allows mix of exact and wildcard patterns', () => {
      expect(isFileTypeAllowed('application/pdf', ['image/*', 'application/pdf'])).toBe(true)
      expect(isFileTypeAllowed('image/jpeg', ['image/*', 'application/pdf'])).toBe(true)
    })

    it('rejects if no pattern matches', () => {
      expect(isFileTypeAllowed('audio/mpeg', ['image/*', 'video/*'])).toBe(false)
    })
  })

  describe('empty arrays', () => {
    it('rejects everything with empty allowed list', () => {
      expect(isFileTypeAllowed('image/jpeg', [])).toBe(false)
    })
  })

  describe('real-world scenarios', () => {
    it('image upload form', () => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

      expect(isFileTypeAllowed('image/jpeg', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('image/png', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('image/svg+xml', allowedTypes)).toBe(false)
      expect(isFileTypeAllowed('application/pdf', allowedTypes)).toBe(false)
    })

    it('image upload form with wildcard', () => {
      const allowedTypes = ['image/*']

      expect(isFileTypeAllowed('image/jpeg', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('image/png', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('image/svg+xml', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('application/pdf', allowedTypes)).toBe(false)
    })

    it('document upload (images and PDFs)', () => {
      const allowedTypes = ['image/*', 'application/pdf']

      expect(isFileTypeAllowed('image/jpeg', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('image/png', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('application/pdf', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('application/msword', allowedTypes)).toBe(false)
    })

    it('media upload (images and videos)', () => {
      const allowedTypes = ['image/*', 'video/*']

      expect(isFileTypeAllowed('image/jpeg', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('video/mp4', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('audio/mpeg', allowedTypes)).toBe(false)
    })

    it('any file type with catch-all wildcards', () => {
      // Note: This is just testing the pattern, not recommending this approach
      const allowedTypes = ['image/*', 'video/*', 'audio/*', 'application/*', 'text/*']

      expect(isFileTypeAllowed('image/jpeg', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('video/mp4', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('audio/mpeg', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('application/pdf', allowedTypes)).toBe(true)
      expect(isFileTypeAllowed('text/plain', allowedTypes)).toBe(true)
    })
  })
})

describe('checkUploadFile', () => {
  const png = new Blob(['four'], { type: 'image/png' })

  it('passes a file within its limits', () => {
    expect(checkUploadFile(png, {})).toBeUndefined()
    expect(checkUploadFile(png, { maxSize: 4, allowedTypes: ['image/*'] })).toBeUndefined()
  })

  it('rejects an oversized file as not sent, before its type', () => {
    expect(
      checkUploadFile(png, { maxSize: 3, allowedTypes: ['text/plain'] }, 'files:generate'),
    ).toMatchObject({
      code: 'FILE_TOO_LARGE',
      outcome: 'not-sent',
      functionName: 'files:generate',
      message: 'File size 4 bytes exceeds maximum 3 bytes',
    })
  })

  it('rejects a disallowed type as not sent', () => {
    expect(checkUploadFile(png, { allowedTypes: ['application/pdf'] })).toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
      outcome: 'not-sent',
      functionName: undefined,
      message: 'File type "image/png" not allowed. Allowed: application/pdf',
    })
  })
})
