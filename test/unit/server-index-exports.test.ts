import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ public: { convex: {} } }),
}))

describe('server entrypoint exports', () => {
  let serverApi: typeof import('../../src/runtime/server/index')

  beforeAll(async () => {
    serverApi = await import('../../src/runtime/server/index')
  })

  it('exports exactly the supported runtime surface', () => {
    expect(Object.keys(serverApi).sort()).toEqual(['serverConvex'])
  })
})
