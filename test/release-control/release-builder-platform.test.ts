import { describe, expect, it } from 'vitest'

import {
  assertReleaseBuilderPlatform,
  releaseBuilderPlatform,
} from '../../scripts/release-builder-platform.mjs'

describe('release builder platform', () => {
  it('admits the reviewed Linux publishing authority', () => {
    expect(assertReleaseBuilderPlatform('linux')).toBe('linux')
    expect(releaseBuilderPlatform).toBe('linux')
  })

  it.each(['darwin', 'win32'] as const)(
    'rejects non-authoritative %s package bytes',
    (platform) => {
      expect(() => assertReleaseBuilderPlatform(platform)).toThrow(
        'Release artifacts, candidate locks, and release smoke must be created on the reviewed Linux builder.',
      )
    },
  )
})
