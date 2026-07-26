import { describe, expect, it, vi } from 'vitest'

import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import { createDevtoolsSink } from '../../src/runtime/devtools/sink'
import {
  createConvexRuntimeContext,
  readConvexRuntimeContext,
} from '../../src/runtime/runtime-context'
import { createLogger } from '../../src/runtime/utils/logger'

function createOwnerHarness() {
  const identityListeners = new Set<() => void>()
  const client = {
    query: vi.fn(),
    mutation: vi.fn(),
    action: vi.fn(),
    onUpdate: vi.fn(),
  } as never
  const attachment = createBetterConvexAttachment({
    client,
    identity: {
      snapshot: () => ({
        authEnabled: true,
        settled: true,
        identityKey: 'user:test',
        identityGeneration: 0,
        error: null,
      }),
      waitForInitialSettlement: async () => {},
      subscribe(listener) {
        identityListeners.add(listener)
        return () => identityListeners.delete(listener)
      },
    },
  })

  return {
    attachment,
    changeIdentity() {
      for (const listener of [...identityListeners]) listener()
    },
  }
}

describe('ConvexRuntimeContext diagnostics ownership', () => {
  it.each([null, undefined, false, 0, 'server'])(
    'treats non-app server placeholder %j as no client runtime',
    (value) => {
      expect(readConvexRuntimeContext(value)).toBeUndefined()
    },
  )

  it('clears identity-owned diagnostics through the owner event seam', () => {
    const harness = createOwnerHarness()
    const runtime = createConvexRuntimeContext(harness.attachment, createLogger(false))
    const sink = createDevtoolsSink()
    runtime.attachDevtoolsSink(sink)
    sink.registerMutation({
      name: 'notes:create',
      type: 'mutation',
      args: {},
      state: 'pending',
      hasOptimisticUpdate: false,
      startedAt: 1,
    })

    harness.changeIdentity()

    expect(sink.getMutations()).toEqual([])
  })

  it('disposes replaced, detached, owner-disposed, and late sinks exactly once', () => {
    const harness = createOwnerHarness()
    const runtime = createConvexRuntimeContext(harness.attachment, createLogger(false))
    const first = createDevtoolsSink()
    const firstDispose = vi.spyOn(first, 'dispose')
    const detachFirst = runtime.attachDevtoolsSink(first)
    const second = createDevtoolsSink()
    const secondDispose = vi.spyOn(second, 'dispose')

    expect(detachFirst).toBeTypeOf('function')
    expect(runtime.attachDevtoolsSink(second)).toBeTypeOf('function')
    expect(firstDispose).toHaveBeenCalledTimes(1)
    detachFirst?.()
    expect(firstDispose).toHaveBeenCalledTimes(1)

    runtime.dispose()
    expect(secondDispose).toHaveBeenCalledTimes(1)
    expect(runtime.getDevtoolsSink()).toBeNull()

    const late = createDevtoolsSink()
    const lateDispose = vi.spyOn(late, 'dispose')
    expect(runtime.attachDevtoolsSink(late)).toBeNull()
    expect(lateDispose).toHaveBeenCalledTimes(1)
  })
})
