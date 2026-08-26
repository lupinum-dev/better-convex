import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getReleaseFamilyTag,
  requirePreparedReleaseNotes,
} from '../../scripts/release-changelog.mjs'

describe('prepared release changelog', () => {
  const tag = 'v1.0.0-beta.1'

  it('returns the exact prepared release section', () => {
    expect(
      requirePreparedReleaseNotes(
        `# Changelog\n\n## ${tag}\n\n- Ship the certified package set.\n\n## v0.7.0\n\n- Older release.\n`,
        tag,
      ),
    ).toBe('- Ship the certified package set.')
  })

  it('uses one root release tag for the aligned beta package set', () => {
    const workspace = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version: string
    }
    const vue = JSON.parse(readFileSync(resolve('packages/vue/package.json'), 'utf8')) as {
      version: string
    }
    const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8')
    const currentTag = `v${workspace.version}`

    expect(vue.version).toBe(workspace.version)
    expect(getReleaseFamilyTag(workspace.version)).toBe(currentTag)
    expect(requirePreparedReleaseNotes(changelog, currentTag)).toContain('OAuth')
  })

  it.each([
    null,
    undefined,
    '',
    ' 0.8.0',
    '0.8',
    'v0.8.0',
    '0.8.0 beta.40',
    '01.2.3',
    '1.2.3-01',
    '1.2.3-alpha..1',
  ])('rejects malformed release-family version %j', (version) => {
    expect(() => getReleaseFamilyTag(version)).toThrow(/release-family version/u)
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
