import { describe, expect, it } from 'vitest'

import { assertConvexComposableScope } from '../../src/runtime/utils/composable-scope'

describe('assertConvexComposableScope', () => {
  it.each(['useConvexQuery', 'useConvexPaginatedQuery', 'useConvexFileUpload'] as const)(
    'throws for %s when on client without scope',
    (composable) => {
      expect(() => assertConvexComposableScope(composable, true, undefined)).toThrow(
        `[${composable}] Must be called within component setup/effect scope. For middleware/plugins use useConvex() (client) or serverConvex() (server).`,
      )
    },
  )

  it('does not throw when scope is available', () => {
    expect(() => assertConvexComposableScope('useConvexQuery', true, {})).not.toThrow()
  })

  it('does not throw on server even without scope', () => {
    expect(() =>
      assertConvexComposableScope('useConvexPaginatedQuery', false, undefined),
    ).not.toThrow()
  })
})
