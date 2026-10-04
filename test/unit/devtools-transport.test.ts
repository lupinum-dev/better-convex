import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cloneDevtoolsPayload,
  createUiDevtoolsTransport,
} from '../../src/runtime/devtools/transport'

function installMockWindow() {
  const listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  const parentMessages: Array<{ data: unknown; origin: string }> = []

  const windowMock = {
    location: { origin: 'https://example.test' },
    parent: {
      postMessage(data: unknown, origin: string) {
        parentMessages.push({ data, origin })
      },
    },
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type: string, listener: (event: MessageEvent) => void) {
      listeners.get(type)?.delete(listener)
    },
    dispatchMessage(event: MessageEvent) {
      for (const listener of listeners.get('message') || []) {
        listener(event)
      }
    },
  }

  vi.stubGlobal('window', windowMock)
  return { windowMock, parentMessages }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('devtools transport', () => {
  it.each([
    ['unavailable', undefined],
    [
      'a throwing constructor',
      function ThrowingBroadcastChannel() {
        throw new Error('blocked')
      },
    ],
  ])('falls back to postMessage when BroadcastChannel is %s', (_name, broadcastChannel) => {
    installMockWindow()
    vi.stubGlobal('BroadcastChannel', broadcastChannel)

    const transport = createUiDevtoolsTransport('convex-devtools')
    expect(transport.kind).toBe('post-message')
    transport.close()
  })

  it('wraps and unwraps messages with postMessage fallback', () => {
    const { windowMock, parentMessages } = installMockWindow()
    vi.stubGlobal('BroadcastChannel', undefined)

    const transport = createUiDevtoolsTransport('convex-devtools')
    const listener = vi.fn()
    transport.addEventListener('message', listener)

    transport.postMessage({ type: 'PING' })
    expect(parentMessages).toHaveLength(1)

    const outboundEnvelope = parentMessages[0]!.data
    windowMock.dispatchMessage({
      data: outboundEnvelope,
      origin: 'https://example.test',
      source: null,
    } as MessageEvent)

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { type: 'PING' },
      }),
    )

    transport.close()
  })
})

describe('cloneDevtoolsPayload', () => {
  it('uses structuredClone when available', () => {
    const input = { at: new Date(0), nested: { a: 1 } }
    const result = cloneDevtoolsPayload(input)
    // A JSON clone would turn the Date into a string.
    expect(result).toEqual(input)
    expect(result.at).toBeInstanceOf(Date)
    expect(result.nested).not.toBe(input.nested)
  })

  it('falls back to JSON clone when structuredClone throws', () => {
    vi.stubGlobal(
      'structuredClone',
      vi.fn(() => {
        throw new Error('fail')
      }),
    )

    const input = { nested: { a: 1 } }
    const result = cloneDevtoolsPayload(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(result.nested).not.toBe(input.nested)
  })
})
