import {
  createBetterConvex,
  useConvex,
  useConvexConnectionState,
  useConvexQuery,
} from 'better-convex-vue'
import { makeFunctionReference } from 'convex/server'
import { createApp, defineComponent, h, shallowRef } from 'vue'

import type { EmbeddedConsumerProof } from './proof-window'

let app: ReturnType<typeof createApp> | null = null
let plugin: ReturnType<typeof createBetterConvex> | null = null
let clientKeys: string[] = []
let connected: { value: boolean } | undefined
let queryState:
  | {
      data: { value: unknown }
      status: { value: string }
      pending: { value: boolean }
    }
  | undefined

const proof: EmbeddedConsumerProof = {
  vueIdentity: shallowRef,
  attach() {
    const host = window.__betterConvexEmbeddedHost
    if (!host) throw new Error('Embedded host proof is unavailable')
    if (app) throw new Error('Embedded consumer is already attached')
    plugin = createBetterConvex({ attachment: host.attachment() })
    const Consumer = defineComponent({
      setup() {
        clientKeys = Object.keys(useConvex()).sort()
        connected = useConvexConnectionState().isConnected
        queryState = useConvexQuery(
          makeFunctionReference<'query'>('notes:embeddedIdentityProbe'),
          {},
          { auth: 'required' },
        )
        return () => h('main', { 'data-embedded': 'true' }, queryState?.status.value ?? 'detached')
      },
    })
    app = createApp(Consumer)
    app.use(plugin)
    app.mount('#embedded-app')
    return proof.snapshot()
  },
  snapshot() {
    return {
      queryData: queryState?.data.value ?? null,
      queryStatus: queryState?.status.value ?? 'detached',
      queryPending: queryState?.pending.value ?? false,
      connected: connected?.value ?? false,
      rendered: document.querySelector('[data-embedded]')?.textContent ?? null,
    }
  },
  clientKeys: () => clientKeys,
  unmount() {
    app?.unmount()
    app = null
    plugin = null
    connected = undefined
    return proof.snapshot()
  },
}

window.__betterConvexEmbeddedConsumer = proof
