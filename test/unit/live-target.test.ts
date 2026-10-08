// `pnpm test:live` deploys the starter with operator-only test functions that can disable users
// and delete OAuth clients. A production key in a maintainer's shell must never be used.
import { describe, expect, it } from 'vitest'

import { liveTarget } from '../live/target'

describe('the live smoke target', () => {
  it.each([
    ['prod:happy-animal-123|secret', 'CONVEX_DEPLOY_KEY is a "prod" key'],
    ['dev:happy-animal-123|secret', 'CONVEX_DEPLOY_KEY is a "dev" key'],
    ['project:team:project|secret', 'CONVEX_DEPLOY_KEY is a "project" key'],
    ['secret-without-a-kind', 'CONVEX_DEPLOY_KEY is a "unknown" key'],
  ])('refuses the deploy key %s, and never prints its secret', (key, message) => {
    let error: unknown
    try {
      liveTarget({ CONVEX_DEPLOY_KEY: key, BCN_LIVE_LOCAL: '1' })
    } catch (caught) {
      error = caught
    }
    expect((error as Error).message).toMatch(message)
    expect((error as Error).message).not.toContain('secret')
  })

  it('deploys a preview key to the named preview deployment', () => {
    expect(
      liveTarget({
        CONVEX_DEPLOY_KEY: 'preview:team:project|key',
        BCN_LIVE_PREVIEW_NAME: 'bcn-live-42',
      }),
    ).toEqual({
      kind: 'preview',
      deployKey: 'preview:team:project|key',
      previewName: 'bcn-live-42',
    })
  })

  it('runs on the local backend only when asked to', () => {
    expect(liveTarget({ BCN_LIVE_LOCAL: '1' })).toEqual({ kind: 'local' })
    expect(() => liveTarget({})).toThrow('pnpm test:live needs CONVEX_DEPLOY_KEY')
  })
})
