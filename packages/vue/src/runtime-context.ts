import { ConvexClient } from 'convex/browser'
import type { App, InjectionKey, ObjectPlugin } from 'vue'
import { inject, readonly, shallowRef } from 'vue'

import {
  attachClientIdentity,
  type AttachedClientIdentityState,
  type BetterConvexAttachment,
} from './internal/attached-runtime'
import type { BrowserAuthAdapter } from './internal/auth-adapter'
import {
  createBetterConvexBrowserRuntime,
  type BetterConvexBrowserRuntime,
} from './internal/browser-runtime'

export interface BetterConvexVueRuntime {
  readonly browser: BetterConvexBrowserRuntime
  readonly identity: AttachedClientIdentityState
}

const BETTER_CONVEX_KEY: InjectionKey<BetterConvexVueRuntime> = Symbol('@lupinum/better-convex-vue')
// Private cross-package seam used by the Nuxt owner to reconcile one provider
// operation with the already-installed Convex runtime. It is intentionally not
// part of BetterConvexPlugin or any package export.
const INTERNAL_REFRESH_AUTH = Symbol.for('better-convex-vue:internal-refresh-auth')

export type BetterConvexAuthAdapter = BrowserAuthAdapter

export type CreateBetterConvexOptions =
  | { convexUrl: string; auth?: BetterConvexAuthAdapter; attachment?: never }
  | {
      attachment: BetterConvexAttachment
      convexUrl?: never
      auth?: never
    }

export type BetterConvexPlugin = ObjectPlugin & {
  /** Safe cross-framework attachment; available after plugin installation. */
  attachment(): BetterConvexAttachment
}

function makeClient(convexUrl: string) {
  return new ConvexClient(convexUrl, { unsavedChangesWarning: false })
}

export function createBetterConvex(options: CreateBetterConvexOptions): BetterConvexPlugin {
  let installed = false
  let dispose: (() => Promise<void> | void) | null = null
  let installedAttachment: BetterConvexAttachment | null = null
  let ownedBrowser: BetterConvexBrowserRuntime | null = null

  return Object.freeze({
    install(app: App) {
      if (installed) throw new Error('[better-convex-vue] plugin is already installed')
      installed = true
      const attached = 'attachment' in options ? options.attachment : null
      const browser = attached
        ? null
        : createBetterConvexBrowserRuntime({
            clientFactory: () => makeClient(options.convexUrl!),
            auth: options.auth,
          })
      ownedBrowser = browser
      const attachment = attached ?? browser!.attachment
      const installedBrowser = browser ?? createAttachedBrowserFacade(attachment)
      installedAttachment = attachment
      const identity = attachClientIdentity(attachment)
      const runtime: BetterConvexVueRuntime = Object.freeze({
        browser: installedBrowser,
        identity,
      })
      app.provide(BETTER_CONVEX_KEY, runtime)
      dispose = async () => {
        identity.dispose()
        await browser?.dispose()
      }
      app.onUnmount(() => void dispose?.())
    },
    attachment() {
      if (!installedAttachment) {
        throw new Error(
          '[better-convex-vue] plugin must be installed before reading its attachment',
        )
      }
      return installedAttachment
    },
    async [INTERNAL_REFRESH_AUTH]() {
      if (!ownedBrowser) {
        throw new Error('[better-convex-vue] only the owning plugin can refresh authentication')
      }
      await ownedBrowser.refreshAuth()
    },
  })
}

function createAttachedBrowserFacade(
  attachment: BetterConvexAttachment,
): BetterConvexBrowserRuntime {
  const state = shallowRef(attachment.connection?.snapshot() ?? disconnectedState())
  let consumers = 0
  let stop: (() => void) | null = null
  const addConsumer = () => {
    consumers += 1
    if (consumers === 1 && attachment.connection) {
      state.value = attachment.connection.snapshot()
      stop = attachment.connection.subscribe((next) => {
        state.value = next
      })
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      consumers -= 1
      if (consumers === 0) {
        stop?.()
        stop = null
      }
    }
  }
  return {
    handle: attachment.client,
    identity: attachment.identity,
    attachment,
    connection: {
      state: readonly(state),
      addConsumer,
    },
    clientFor: (mode) => (mode === 'none' ? attachment.anonymousClient : attachment.client),
    ready: () => attachment.identity.waitForInitialSettlement(),
    refreshAuth: async () => {},
    dispose: async () => {},
  }
}

function disconnectedState() {
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

export function useBetterConvexRuntime(): BetterConvexVueRuntime {
  const runtime = useOptionalBetterConvexRuntime()
  if (!runtime) throw new Error('[better-convex-vue] plugin is not installed in this Vue app')
  return runtime
}

/** Internal SSR seam: callable composables may be created during render but cannot execute there. */
export function useOptionalBetterConvexRuntime(): BetterConvexVueRuntime | null {
  return inject(BETTER_CONVEX_KEY, null)
}
