import { describe, expect, it } from 'vitest'

import { requirePreparedReleaseNotes } from '../../scripts/release-changelog.mjs'

describe('prepared release changelog', () => {
  const tag = 'v0.8.0-beta.40'

  it('returns the exact prepared release section', () => {
    expect(
      requirePreparedReleaseNotes(
        `# Changelog\n\n## ${tag}\n\n- Ship the certified package set.\n\n## v0.7.0\n\n- Older release.\n`,
        tag,
      ),
    ).toBe('- Ship the certified package set.')
  })

  it.each([
    ['an Unreleased section only', '# Changelog\n\n## Unreleased\n\n- Draft notes.\n'],
    ['an empty exact section', `# Changelog\n\n## ${tag}\n\n## v0.7.0\n\n- Older.\n`],
    ['a prefixed version', `# Changelog\n\n## preview-${tag}\n\n- Wrong release.\n`],
    ['a suffixed version', `# Changelog\n\n## ${tag}-extra\n\n- Wrong release.\n`],
    [
      'duplicate exact sections',
      `# Changelog\n\n## ${tag}\n\n- First.\n\n## ${tag}\n\n- Second.\n`,
    ],
  ])('rejects %s', (_label, changelog) => {
    expect(() => requirePreparedReleaseNotes(changelog, tag)).toThrow(/CHANGELOG\.md/u)
  })
})
