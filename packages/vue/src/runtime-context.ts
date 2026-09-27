import { ConvexClient } from 'convex/browser'
import type { App, InjectionKey, ObjectPlugin, Ref } from 'vue'
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
import { DISCONNECTED_CONNECTION_STATE } from './internal/connection-state'
import type { ClientIdentitySnapshot } from './internal/identity-port'

export interface BetterConvexVueRuntime {
  readonly browser: BetterConvexBrowserRuntime
  readonly identity: AttachedClientIdentityState
}

const BETTER_CONVEX_KEY: InjectionKey<BetterConvexVueRuntime> = Symbol('@lupinum/better-convex-vue')
// Owner-only auth refresh, reachable through `refreshBetterConvexAuth` in the
// private `/internal` entry. Keeping it off the plugin object means an attached
// (embedded) child can never gain provider control.
const ownerAuthRefresh = new WeakMap<BetterConvexPlugin, () => Promise<void>>()

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

  const plugin: BetterConvexPlugin = Object.freeze({
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
  })
  ownerAuthRefresh.set(plugin, async () => {
    if (!ownedBrowser) {
      throw new Error('[better-convex-vue] only the owning plugin can refresh authentication')
    }
    await ownedBrowser.refreshAuth()
  })
  return plugin
}

/**
 * Re-read the provider session through the auth adapter of a plugin created
 * with `convexUrl` and `auth`. Rejects for an attached plugin.
 */
export async function refreshBetterConvexAuth(plugin: BetterConvexPlugin): Promise<void> {
  const refresh = ownerAuthRefresh.get(plugin)
  if (!refresh) {
    throw new Error('[better-convex-vue] refreshBetterConvexAuth requires a Better Convex plugin')
  }
  await refresh()
}

function createAttachedBrowserFacade(
  attachment: BetterConvexAttachment,
): BetterConvexBrowserRuntime {
  const state = shallowRef(
    attachment.connection?.snapshot() ?? { ...DISCONNECTED_CONNECTION_STATE },
  )
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

export function useBetterConvexRuntime(): BetterConvexVueRuntime {
  const runtime = useOptionalBetterConvexRuntime()
  if (!runtime) throw new Error('[better-convex-vue] plugin is not installed in this Vue app')
  return runtime
}

/** The app's one reactive identity snapshot; composables share it instead of subscribing. */
export function useBetterConvexIdentity(): Readonly<Ref<ClientIdentitySnapshot>> {
  return useBetterConvexRuntime().identity.snapshot
}

/** Internal SSR seam: callable composables may be created during render but cannot execute there. */
export function useOptionalBetterConvexRuntime(): BetterConvexVueRuntime | null {
  return inject(BETTER_CONVEX_KEY, null)
}
