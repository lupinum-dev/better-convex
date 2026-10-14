import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest'

import type { ConvexServerEvent } from '../../src/runtime/server/index'

describe('server entrypoint exports', () => {
  let serverApi: typeof import('../../src/runtime/server/index')

  beforeAll(async () => {
    serverApi = await import('../../src/runtime/server/index')
  })

  it('exports exactly the supported runtime surface', () => {
    expect(Object.keys(serverApi).sort()).toEqual([
      'ServerConvexValidationError',
      'getConvexUser',
      'requireConvexUser',
      'serverConvex',
      'toConvexH3Error',
    ])
  })

  // Catches dropping the public event type, or a helper that stops taking it:
  // callers type their parameters with it (`pnpm typecheck` fails).
  it('exports the event type the helpers accept', () => {
    expectTypeOf(serverApi.getConvexUser).parameter(0).toEqualTypeOf<ConvexServerEvent>()
  })

  it('exports the validation error class callers can match with instanceof', () => {
    expect(() => serverApi.serverConvex({} as never, { auth: 'always' as never })).toThrow(
      serverApi.ServerConvexValidationError,
    )
  })
})
