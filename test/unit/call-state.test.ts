import { describe, expect, it } from 'vitest'
import { isProxy } from 'vue'

import { ConvexCallError } from '../../packages/vue/src/errors'
import { createClientCallState } from '../../packages/vue/src/internal/call-state'

const callError = (message: string) => new ConvexCallError({ kind: 'unknown', message })

describe('createClientCallState', () => {
  it('exposes the exact result and error objects rather than reactive proxies', () => {
    const state = createClientCallState<{ nested: { id: string } }>()
    const result = { nested: { id: 'a' } }
    expect(state.commitSuccess(state.start(), result)).toBe(true)
    expect(state.data.value).toBe(result)
    expect(isProxy(state.data.value)).toBe(false)

    const error = callError('boom')
    expect(state.commitError(state.start(), error)).toBe(true)
    expect(state.error.value).toBe(error)
    expect(isProxy(state.error.value)).toBe(false)
  })

  it('tracks pending, success, error, and reset state', () => {
    const state = createClientCallState<string>()

    expect(state.status.value).toBe('idle')
    expect(state.pending.value).toBe(false)
    expect(state.data.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()

    const first = state.start()
    expect(state.status.value).toBe('pending')
    expect(state.pending.value).toBe(true)

    expect(state.commitSuccess(first, 'ok')).toBe(true)
    expect(state.status.value).toBe('success')
    expect(state.pending.value).toBe(false)
    expect(state.data.value).toBe('ok')

    const second = state.start()
    const error = callError('boom')
    expect(state.commitError(second, error)).toBe(true)
    expect(state.status.value).toBe('error')
    expect(state.error.value).toBe(error)
    expect(state.data.value).toBeUndefined()

    state.reset()
    expect(state.status.value).toBe('idle')
    expect(state.pending.value).toBe(false)
    expect(state.data.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
  })

  it('rejects stale success and error commits after newer starts or reset', () => {
    const state = createClientCallState<string>()

    const stale = state.start()
    const current = state.start()

    expect(state.commitSuccess(stale, 'stale')).toBe(false)
    expect(state.status.value).toBe('pending')
    expect(state.data.value).toBeUndefined()

    expect(state.commitError(stale, callError('stale'))).toBe(false)
    expect(state.status.value).toBe('pending')
    expect(state.error.value).toBeUndefined()

    expect(state.commitSuccess(current, 'current')).toBe(true)
    expect(state.data.value).toBe('current')

    const resetStale = state.start()
    state.reset()

    expect(state.commitSuccess(resetStale, 'after-reset')).toBe(false)
    expect(state.commitError(resetStale, callError('after-reset'))).toBe(false)
    expect(state.status.value).toBe('idle')
    expect(state.data.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
  })

  it('returns a commit signal so superseded work cannot own public state', () => {
    const state = createClientCallState<string>()

    const superseded = state.start()
    state.start() // supersedes `superseded`

    let onSuccessCalls = 0
    let onErrorCalls = 0

    if (state.commitSuccess(superseded, 'stale-success')) {
      onSuccessCalls += 1
    }
    if (state.commitError(superseded, callError('stale-error'))) {
      onErrorCalls += 1
    }

    expect(onSuccessCalls).toBe(0)
    expect(onErrorCalls).toBe(0)
  })
})
