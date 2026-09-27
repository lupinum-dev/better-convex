import { describe, expect, it, vi } from 'vitest'

import { ConvexCallError } from '../../src/runtime/errors'

const payload = vi.hoisted(() => ({
  reducers: new Map<string, (value: unknown) => unknown>(),
  revivers: new Map<string, (value: unknown) => unknown>(),
}))

vi.mock('#app', () => ({
  // Run setup at import so the tests can read the registered reducer and reviver.
  definePayloadPlugin: (setup: () => void) => {
    setup()
    return setup
  },
  definePayloadReducer: (name: string, reduce: (value: unknown) => unknown) => {
    payload.reducers.set(name, reduce)
  },
  definePayloadReviver: (name: string, revive: (value: unknown) => unknown) => {
    payload.revivers.set(name, revive)
  },
}))

async function installPlugin() {
  await import('../../src/runtime/plugins/convex-call-error-payload')
  return {
    reduce: payload.reducers.get('ConvexCallError')!,
    revive: payload.revivers.get('ConvexCallError')!,
  }
}

describe('ConvexCallError payload plugin', () => {
  it('round-trips the public shape, including functionName, as a real instance', async () => {
    const { reduce, revive } = await installPlugin()
    const original = new ConvexCallError({
      kind: 'server',
      message: 'Title is already taken',
      code: 'TITLE_TAKEN',
      status: 409,
      data: { code: 'TITLE_TAKEN', message: 'Title is already taken' },
      functionName: 'notes:create',
    })

    const reduced = reduce(original)
    expect(reduced).toStrictEqual(original.toJSON())
    const revived = revive(JSON.parse(JSON.stringify(reduced)))

    expect(revived).toBeInstanceOf(ConvexCallError)
    expect((revived as ConvexCallError).toJSON()).toStrictEqual(original.toJSON())
    expect('cause' in (revived as object)).toBe(false)
  })

  it('ignores values that are not ConvexCallError instances', async () => {
    const { reduce } = await installPlugin()
    expect(reduce(new Error('plain'))).toBeUndefined()
    expect(reduce(new ConvexCallError({ kind: 'unknown', message: 'x' }).toJSON())).toBeUndefined()
  })

  it.each([
    ['a bare name', { name: 'ConvexCallError' }],
    ['an extra key', { name: 'ConvexCallError', kind: 'server', message: 'x', stack: 'secret' }],
    ['an unknown kind', { name: 'ConvexCallError', kind: 'validation', message: 'x' }],
    ['a numeric code', { name: 'ConvexCallError', kind: 'server', message: 'x', code: 409 }],
    [
      'an empty functionName',
      { name: 'ConvexCallError', kind: 'server', message: 'x', functionName: '' },
    ],
    [
      'a wrapped serialized error',
      { data: { name: 'ConvexCallError', kind: 'server', message: 'x' } },
    ],
  ])('does not revive %s', async (_name, value) => {
    const { revive } = await installPlugin()
    expect(revive(value)).toBeUndefined()
  })
})
