import { createBetterConvex } from '@lupinum/better-convex-vue'
import { createBetterConvexAttachment } from '@lupinum/better-convex-vue/embedded'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, watch, type ComponentPublicInstance } from 'vue'

import { useNuxtApp, useRuntimeConfig, useState } from '#imports'

import type {
  ClientIdentityObserver,
  ClientIdentityPort,
  ClientIdentitySnapshot,
} from '../../packages/vue/src/internal/identity-port'
import { ANONYMOUS_IDENTITY, type AuthIdentity } from '../../src/runtime/auth/auth-identity'
import type {
  ConvexRuntimeContext,
  NuxtConvexAuthController,
} from '../../src/runtime/runtime-context'
import { createLogger } from '../../src/runtime/utils/logger'

let previousWrapper: { unmount: () => void } | null = null
let currentConvexTarget: Record<PropertyKey, unknown> | null = null
let currentAuthTarget: Record<PropertyKey, unknown> | null = null
let currentOwnerTarget: Record<PropertyKey, unknown> | null = null
let currentAuthController: NuxtConvexAuthController | null = null
let currentIdentityObserver: ClientIdentityObserver | null = null
let currentAuthEnabled = true

const convexProxy = new Proxy<Record<PropertyKey, unknown>>(
  {},
  {
    get(_target, key) {
      const target = currentConvexTarget
      if (!target) return undefined
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  },
)

const authProxy = new Proxy<Record<PropertyKey, unknown>>(
  {},
  {
    get(_target, key) {
      const target = currentAuthTarget
      if (!target) return undefined
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  },
)

// Nuxt provides values once per application, while this harness reuses one
// application across captures. Keep the provided context stable and replace
// only its test-owned targets between captures.
const clientProxy = new Proxy<Record<PropertyKey, unknown>>(
  {},
  {
    get(_target, key) {
      const owner = currentOwnerTarget
      const target = owner
        ? ((owner.handle as Record<PropertyKey, unknown> | undefined) ?? owner)
        : currentConvexTarget
      const value = target?.[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  },
)
const anonymousClientProxy = new Proxy<Record<PropertyKey, unknown>>(
  {},
  {
    get(_target, key) {
      const owner = currentOwnerTarget
      const anonymous =
        currentAuthEnabled && owner && typeof owner.getAnonymous === 'function'
          ? owner.getAnonymous()
          : owner
            ? ((owner.handle as Record<PropertyKey, unknown> | undefined) ?? owner)
            : currentConvexTarget
      const value = (anonymous as Record<PropertyKey, unknown> | null)?.[key]
      return typeof value === 'function' ? value.bind(anonymous) : value
    },
  },
)
const anonymousIdentity: ClientIdentityObserver = {
  snapshot: () => ({
    authEnabled: false,
    settled: true,
    identityKey: 'anonymous',
    identityGeneration: 0,
    error: null,
  }),
  waitForInitialSettlement: async () => {},
  subscribe: () => () => {},
}
const identityProxyListeners = new Set<() => void>()

export function identityProxyListenerCount() {
  return identityProxyListeners.size
}

let stopCurrentIdentity: (() => void) | null = null
function setCurrentIdentityObserver(observer: ClientIdentityObserver | null) {
  stopCurrentIdentity?.()
  stopCurrentIdentity = null
  currentIdentityObserver = observer
  if (observer) {
    stopCurrentIdentity = observer.subscribe(() => {
      for (const listener of [...identityProxyListeners]) listener()
    })
  }
  for (const listener of [...identityProxyListeners]) listener()
}
const identityProxy: ClientIdentityObserver = {
  snapshot: () => (currentIdentityObserver ?? anonymousIdentity).snapshot(),
  waitForInitialSettlement: () =>
    (currentIdentityObserver ?? anonymousIdentity).waitForInitialSettlement(),
  subscribe(listener) {
    identityProxyListeners.add(listener)
    return () => identityProxyListeners.delete(listener)
  },
}
function callHarnessClient(
  client: Record<PropertyKey, unknown>,
  method: 'query' | 'mutation' | 'action' | 'onUpdate',
  args: unknown[],
) {
  const callable = client[method]
  if (typeof callable !== 'function') {
    throw new TypeError(`Harness Convex client does not implement ${method}`)
  }
  return Reflect.apply(callable, client, args)
}

function harnessClientHandle(client: Record<PropertyKey, unknown>) {
  return {
    query: ((...args: unknown[]) => callHarnessClient(client, 'query', args)) as never,
    mutation: ((...args: unknown[]) => callHarnessClient(client, 'mutation', args)) as never,
    action: ((...args: unknown[]) => callHarnessClient(client, 'action', args)) as never,
    onUpdate: ((...args: unknown[]) => callHarnessClient(client, 'onUpdate', args)) as never,
  }
}

const attachmentProxy = createBetterConvexAttachment({
  client: harnessClientHandle(clientProxy),
  anonymousClient: harnessClientHandle(anonymousClientProxy),
  identity: identityProxy,
  connection: {
    snapshot() {
      const ownerConnection = currentOwnerTarget?.connection as
        | { state?: { value: unknown } }
        | undefined
      if (ownerConnection?.state?.value) return ownerConnection.state.value as never
      const target = currentConvexTarget as {
        connectionState?: () => unknown
      } | null
      return (target?.connectionState?.() ?? DEFAULT_OWNER_CONNECTION_STATE) as never
    },
    subscribe(listener) {
      const ownerConnection = currentOwnerTarget?.connection as
        | { state?: { value: unknown }; addConsumer?: () => () => void }
        | undefined
      if (ownerConnection?.state && ownerConnection.addConsumer) {
        const remove = ownerConnection.addConsumer()
        const stop = watch(
          () => ownerConnection.state!.value,
          (value) => listener(value as never),
          { flush: 'sync' },
        )
        return () => {
          stop()
          remove()
        }
      }
      const target = currentConvexTarget as {
        subscribeToConnectionState?: (listener: (state: never) => void) => () => void
      } | null
      return target?.subscribeToConnectionState?.(listener) ?? (() => {})
    },
  },
})
const runtimeProxy: ConvexRuntimeContext = {
  attachment: attachmentProxy,
  logger: createLogger(false),
  getAuthController: () => currentAuthController,
  attachAuthController: (controller) => {
    currentAuthController = controller
  },
  getDevtoolsSink: () => null,
  attachDevtoolsSink: (sink) => {
    let active = true
    return () => {
      if (!active) return
      active = false
      sink.dispose()
    }
  },
  dispose: () => {},
}

interface CaptureOptions {
  convex?: unknown
  auth?: unknown
  owner?: unknown
  convexConfig?: Record<string, unknown>
  payloadData?: Record<string, unknown>
  identityObserver?: ClientIdentityObserver
}

export function createIdentityObserverHarness(initial: ClientIdentitySnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const settlementWaiters = new Set<() => void>()
  const observer: ClientIdentityObserver = {
    snapshot: () => snapshot,
    waitForInitialSettlement() {
      if (snapshot.settled) return Promise.resolve()
      return new Promise<void>((resolve) => settlementWaiters.add(resolve))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return {
    observer,
    set(next: ClientIdentitySnapshot) {
      snapshot = next
      if (snapshot.settled) {
        for (const resolve of [...settlementWaiters]) resolve()
        settlementWaiters.clear()
      }
      for (const listener of [...listeners]) listener()
    },
  }
}

const DEFAULT_OWNER_CONNECTION_STATE = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
}

/**
 * A minimal per-app client owner  synthesized from the provided
 * `convex` mock when a test does not pass an explicit `owner`. The query
 * composables reach their transport through the owner (`getPrimary` /
 * `getAnonymous`), so a single-client mock is exposed as both. Tests that need a
 * distinct `none` anonymous client pass an explicit `owner`.
 */
function createSyntheticOwner(): Record<PropertyKey, unknown> {
  const primary = () => currentConvexTarget
  return {
    get handle() {
      const c = currentConvexTarget
      return c
        ? {
            query: c.query,
            mutation: c.mutation,
            action: c.action,
            onUpdate: c.onUpdate,
          }
        : undefined
    },
    getPrimary: () => {
      const c = currentConvexTarget
      return c ? { client: c, identityGeneration: 0 } : null
    },
    getAnonymous: () => primary(),
    replacePrimary: async () => primary(),
    attachIdentityPort: () => {},
    connection: {
      state: { value: { ...DEFAULT_OWNER_CONNECTION_STATE } },
      addConsumer: () => () => {},
    },
    addDisposer: () => {},
    subscribeIdentityChange: () => () => {},
    dispose: async () => {},
  }
}
const syntheticOwner: Record<PropertyKey, unknown> = createSyntheticOwner()

/** Install the narrow auth-port seam used by identity-generation composable tests. */
export function installIdentityPortHarness() {
  let identityGeneration = 0
  const listeners = new Set<() => void>()
  const port: ClientIdentityPort = {
    snapshot: () => ({
      authEnabled: true,
      settled: true,
      identityKey: `user:test-${identityGeneration}` as never,
      identityGeneration,
      error: null,
    }),
    waitForInitialSettlement: async () => {},
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    initializePrimary: async () => {},
    failPrimary: () => {},
  }
  const nuxtApp = useNuxtApp()
  if (!nuxtApp.$convexRuntime) throw new Error('Convex runtime was not installed')
  setCurrentIdentityObserver(port)
  nuxtApp.$convexRuntime.attachAuthController({
    pending: { value: false } as never,
    client: {},
    ready: async () => 'authenticated',
    dispose: () => {},
  })

  return {
    advance() {
      identityGeneration += 1
      for (const listener of [...listeners]) listener()
    },
    listenerCount() {
      return listeners.size
    },
  }
}

export async function captureInNuxt<T>(
  factory: () => T,
  options: CaptureOptions = {},
): Promise<{
  result: T
  nuxtApp: ReturnType<typeof useNuxtApp>
  wrapper: ComponentPublicInstance & { unmount: () => void }
  flush: () => Promise<void>
}> {
  let result: T | undefined
  let nuxtAppRef: ReturnType<typeof useNuxtApp> | undefined

  // Unmount the previous capture's component so its still-alive query watchers
  // do not react to this test's shared `useState`/`$fetch` state (identity-
  // reactive composables refetch on `convex:identity` changes). Tests that need two
  // live components at once pass them to a single capture.
  if (previousWrapper) {
    try {
      previousWrapper.unmount()
    } catch {
      // ignore teardown errors from an already-unmounted wrapper
    }
    previousWrapper = null
  }

  const wrapper = await mountSuspended(
    defineComponent({
      setup() {
        const nuxtApp = useNuxtApp()
        const runtimeConfig = useRuntimeConfig()

        nuxtAppRef = nuxtApp

        // A whole test file shares one implicit Nuxt app, so `useState` auth keys
        // leak between tests. Reset them to a clean slate before the factory runs
        // (composables key identity off `convex:identity`, so a leaked signed-in user
        // would spuriously trigger identity transitions and refetches).
        useState<AuthIdentity>('convex:identity', () => ANONYMOUS_IDENTITY).value =
          ANONYMOUS_IDENTITY
        useState<string | null>('convex:authError', () => null).value = null
        currentAuthController = null
        setCurrentIdentityObserver(null)

        if (!nuxtApp.$convexRuntime) {
          nuxtApp.provide('convexRuntime', runtimeProxy)
        }

        const identityState = useState<AuthIdentity>('convex:identity')
        const pendingState = useState<boolean>('convex:pending', () => false)
        let generation = 0
        let currentKey =
          identityState.value.status === 'authenticated'
            ? `user:${identityState.value.user.id}`
            : 'anonymous'
        const identityListeners = new Set<() => void>()
        const observer: ClientIdentityObserver = {
          snapshot: () => ({
            authEnabled: currentAuthEnabled,
            settled: !pendingState.value,
            identityKey: pendingState.value ? null : (currentKey as never),
            identityGeneration: generation,
            error: null,
          }),
          waitForInitialSettlement: async () => {},
          subscribe(listener) {
            identityListeners.add(listener)
            return () => identityListeners.delete(listener)
          },
        }
        watch(
          [identityState, pendingState],
          () => {
            const nextKey =
              identityState.value.status === 'authenticated'
                ? `user:${identityState.value.user.id}`
                : 'anonymous'
            if (nextKey !== currentKey) generation += 1
            currentKey = nextKey
            for (const listener of [...identityListeners]) listener()
          },
          { flush: 'sync' },
        )
        setCurrentIdentityObserver(options.identityObserver ?? observer)

        if (options.convex === undefined) {
          currentConvexTarget = null
        }
        if (options.auth === undefined) {
          currentAuthTarget = null
        }
        if (options.owner === undefined) {
          // Synthesize a per-app client owner from the convex mock so query
          // composables (which reach transport through the owner) work without
          // every test constructing one. Tests needing a distinct `none`
          // anonymous client pass an explicit `owner`.
          currentOwnerTarget = options.convex !== undefined ? syntheticOwner : null
        }

        if (options.convex !== undefined) {
          currentConvexTarget = options.convex as Record<PropertyKey, unknown>
          if (!(nuxtApp as typeof nuxtApp & { $convex?: unknown }).$convex) {
            nuxtApp.provide('convex', convexProxy)
          }
        }

        if (options.auth !== undefined) {
          currentAuthTarget = options.auth as Record<PropertyKey, unknown>
          if (!(nuxtApp as typeof nuxtApp & { $auth?: unknown }).$auth) {
            nuxtApp.provide('auth', authProxy)
          }
        }

        if (options.owner !== undefined) {
          currentOwnerTarget = options.owner as Record<PropertyKey, unknown>
        }

        const runtimeConfigMutable = runtimeConfig as unknown as {
          public?: Record<string, unknown>
        }
        const publicConfig = (runtimeConfigMutable.public ??= {})
        const convexConfig = (publicConfig.convex ??= {}) as Record<string, unknown>
        // Runtime-composable tests exercise the auth-enabled engine by default,
        // so make that opt-in explicit in the harness. Individual no-auth tests
        // pass `auth: false`; no test inherits the previous capture's mode.
        Object.assign(
          convexConfig,
          {
            url: 'http://127.0.0.1:3214',
            auth: { origin: 'http://localhost:3000' },
          },
          options.convexConfig ?? {},
        )
        currentAuthEnabled = typeof convexConfig.auth === 'object' && convexConfig.auth !== null

        if (options.payloadData) {
          Object.assign(nuxtApp.payload.data, options.payloadData)
        }

        result = factory()

        return () => h('div')
      },
    }),
    {
      global: {
        plugins: [createBetterConvex({ attachment: attachmentProxy })],
      },
    },
  )

  const flush = async () => {
    await nextTick()
    await Promise.resolve()
    await nextTick()
  }

  if (result === undefined || !nuxtAppRef) {
    throw new Error('Failed to capture Nuxt composable result')
  }

  previousWrapper = wrapper as unknown as { unmount: () => void }

  return {
    result,
    nuxtApp: nuxtAppRef,
    wrapper: wrapper as unknown as ComponentPublicInstance & {
      unmount: () => void
    },
    flush,
  }
}

export function createNuxtHarnessVuePlugin() {
  return createBetterConvex({ attachment: attachmentProxy })
}
