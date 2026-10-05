import { describe, expect, it } from 'vitest'

import {
  checkUploadFile,
  isFileTypeAllowed,
  matchesMimeType,
} from '../../packages/vue/src/internal/upload-validation'

describe('matchesMimeType', () => {
  it.each([
    ['image/jpeg', 'image/jpeg', true],
    ['application/pdf', 'application/pdf', true],
    ['application/vnd.ms-excel', 'application/vnd.ms-excel', true],
    ['image/jpeg', 'image/png', false],
    ['image/jpeg', 'video/jpeg', false],
    ['application/json', 'application/pdf', false],
    ['text/html', 'text/plain', false],
    ['image/svg+xml', 'image/*', true],
    ['video/quicktime', 'video/*', true],
    ['audio/ogg', 'audio/*', true],
    ['application/vnd.ms-excel', 'application/*', true],
    ['text/css', 'text/*', true],
    ['video/mp4', 'image/*', false],
    ['text/plain', 'image/*', false],
    ['', 'image/*', false],
    ['image/jpeg', '', false],
    // MIME types are matched case-sensitively; browsers report them in lowercase.
    ['IMAGE/JPEG', 'image/jpeg', false],
    ['image/jpeg', 'IMAGE/JPEG', false],
  ])('matches %j against %j: %s', (fileType, pattern, expected) => {
    expect(matchesMimeType(fileType, pattern)).toBe(expected)
  })
})

describe('isFileTypeAllowed', () => {
  it.each([
    ['image/png', ['image/jpeg', 'image/png', 'image/gif'], true],
    ['image/svg+xml', ['image/jpeg', 'image/png'], false],
    ['video/mp4', ['image/*', 'video/*'], true],
    ['application/pdf', ['image/*', 'application/pdf'], true],
    ['image/jpeg', ['image/*', 'application/pdf'], true],
    ['application/msword', ['image/*', 'application/pdf'], false],
    ['audio/mpeg', ['image/*', 'video/*'], false],
    ['image/jpeg', [], false],
  ])('allows %j for %j: %s', (fileType, allowedTypes, expected) => {
    expect(isFileTypeAllowed(fileType, allowedTypes)).toBe(expected)
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
