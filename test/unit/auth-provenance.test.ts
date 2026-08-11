import { describe, expect, it } from 'vitest'

import {
  hasProminentModificationNotice,
  matchesAuthorizedSeam,
} from '../../scripts/check-auth-provenance.mjs'

const upstreamCommit = 'c628916b451a6b4cff0f5464f134475464b1a6da'

describe('auth provenance contract', () => {
  it('matches only explicitly authorized source paths and directory seams', () => {
    expect(matchesAuthorizedSeam('src/client/adapter.ts', 'src/client/adapter.ts')).toBe(true)
    expect(
      matchesAuthorizedSeam('src/component/_generated/api.ts', 'src/component/_generated/**'),
    ).toBe(true)
    expect(matchesAuthorizedSeam('src/component/schema.ts', 'src/component/_generated/**')).toBe(
      false,
    )
  })

  it('requires a prominent upstream, commit, and license modification notice', () => {
    const notice = `/*
     * Adapted from get-convex/better-auth at
     * ${upstreamCommit} (Apache-2.0).
     */`

    expect(hasProminentModificationNotice(notice, upstreamCommit)).toBe(true)
    expect(
      hasProminentModificationNotice(notice.replace('Apache-2.0', 'MIT'), upstreamCommit),
    ).toBe(false)
    expect(hasProminentModificationNotice(notice, '0'.repeat(40))).toBe(false)
  })
})
