import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

const clients = vi.hoisted(() => [] as Array<{ address: string; options: unknown }>)

vi.mock('convex/browser', () => ({
  ConvexClient: class {
    constructor(address: string, options: unknown) {
      clients.push({ address, options })
    }
    connectionState() {
      return {
        hasInflightRequests: false,
        isWebSocketConnected: false,
        timeOfOldestInflightRequest: null,
        hasEverConnected: false,
        connectionCount: 0,
        connectionRetries: 0,
        inflightMutations: 0,
        inflightActions: 0,
      }
    }
    subscribeToConnectionState() {
      return () => {}
    }
    async close() {}
  },
}))

// eslint-disable-next-line import/first
import {
  createBetterConvex,
  type BetterConvexClientOptions,
  type CreateBetterConvexOptions,
} from '../../packages/vue/src/runtime-context'

const CONVEX_URL = 'https://client-options.convex.cloud'

function install(options: CreateBetterConvexOptions) {
  const app = createApp(defineComponent({ render: () => h('div') }))
  app.use(createBetterConvex(options))
  return app
}

beforeEach(() => {
  clients.length = 0
})

describe('createBetterConvex clientOptions', () => {
  it('keeps the unsaved-changes prompt off by default', () => {
    install({ convexUrl: CONVEX_URL })

    expect(clients).toEqual([{ address: CONVEX_URL, options: { unsavedChangesWarning: false } }])
  })

  it('passes exactly the supported ConvexClient options through', () => {
    const TestWebSocket = function TestWebSocket() {}
    install({
      convexUrl: CONVEX_URL,
      clientOptions: {
        verbose: true,
        webSocketConstructor: TestWebSocket as unknown as typeof WebSocket,
        skipConvexDeploymentUrlCheck: true,
        unsavedChangesWarning: true,
      },
    })

    expect(clients[0]?.options).toEqual({
      verbose: true,
      webSocketConstructor: TestWebSocket,
      skipConvexDeploymentUrlCheck: true,
      unsavedChangesWarning: true,
    })
  })

  it.each([
    [{ verbose: 'yes' }, 'clientOptions.verbose must be a boolean'],
    [{ webSocketConstructor: 'ws' }, 'clientOptions.webSocketConstructor must be a WebSocket'],
    [{ disabled: true }, 'clientOptions.disabled is not supported'],
    [{ logger: false }, 'clientOptions.logger is not supported'],
    [{ authRefreshTokenLeewaySeconds: 1 }, 'clientOptions.authRefreshTokenLeewaySeconds'],
  ])('rejects %j before constructing a client', (clientOptions, message) => {
    expect(() =>
      createBetterConvex({
        convexUrl: CONVEX_URL,
        clientOptions: clientOptions as BetterConvexClientOptions,
      }),
    ).toThrow(message)
    expect(clients).toEqual([])
  })

  it('rejects client options on an attached child, which owns no client', () => {
    expect(() =>
      createBetterConvex({
        attachment: {} as never,
        clientOptions: { verbose: true },
      } as unknown as CreateBetterConvexOptions),
    ).toThrow('clientOptions cannot be combined with attachment')
  })

  it('types client options as the owning variant only', () => {
    expectTypeOf<BetterConvexClientOptions>().toEqualTypeOf<{
      readonly verbose?: boolean
      readonly webSocketConstructor?: typeof WebSocket
      readonly skipConvexDeploymentUrlCheck?: boolean
      readonly unsavedChangesWarning?: boolean
    }>()
    // @ts-expect-error an attached child cannot configure clients
    const attached: CreateBetterConvexOptions = { attachment: {} as never, clientOptions: {} }
    void attached
  })
})
