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
import type { ConvexAuthMode } from './use-query'

export interface BetterConvexVueRuntime {
  readonly browser: BetterConvexBrowserRuntime
  readonly identity: AttachedClientIdentityState
  /** Auth mode for queries whose options omit `auth`. */
  readonly defaultQueryAuth: ConvexAuthMode
}

const BETTER_CONVEX_KEY: InjectionKey<BetterConvexVueRuntime> = Symbol('@lupinum/better-convex-vue')
// Owner-only auth refresh, reachable through `refreshBetterConvexAuth` in the
// private `/internal` entry. Keeping it off the plugin object means an attached
// (embedded) child can never gain provider control.
const ownerAuthRefresh = new WeakMap<BetterConvexPlugin, () => Promise<void>>()

export type BetterConvexAuthAdapter = BrowserAuthAdapter

/**
 * The `ConvexClient` options Better Convex passes through to every browser
 * client it constructs (the identity-scoped primary and the anonymous
 * `auth: 'none'` client). Authentication, `disabled`, and logging hooks stay
 * owned by the runtime and are not accepted here.
 */
export interface BetterConvexClientOptions {
  /** Log Convex client debug output. Convex defaults this to `false`. */
  readonly verbose?: boolean
  /** Use this `WebSocket` constructor instead of the global one. */
  readonly webSocketConstructor?: typeof WebSocket
  /** Allow a self-hosted deployment URL that does not look like `*.convex.cloud`. */
  readonly skipConvexDeploymentUrlCheck?: boolean
  /**
   * Prompt before the page unloads while mutations are pending. Better Convex
   * defaults this to `false`; Convex itself defaults it to `true` in browsers.
   */
  readonly unsavedChangesWarning?: boolean
}

export type CreateBetterConvexOptions = (
  | {
      convexUrl: string
      auth?: BetterConvexAuthAdapter
      clientOptions?: BetterConvexClientOptions
      /** Experimental: not covered by semver */
      experimental?: { keepAlive?: { ms: number; max: number } }
      attachment?: never
    }
  | {
      attachment: BetterConvexAttachment
      convexUrl?: never
      auth?: never
      clientOptions?: never
      experimental?: never
    }
) & {
  /**
   * Auth mode for `useConvexQuery` / `useConvexPaginatedQuery` calls that omit
   * `auth`. A call site's own `auth` always wins. @default 'optional'
   */
  defaultQueryAuth?: ConvexAuthMode
}

const QUERY_AUTH_MODES: readonly ConvexAuthMode[] = ['optional', 'required', 'none']

function normalizeDefaultQueryAuth(input: unknown): ConvexAuthMode {
  if (input === undefined) return 'optional'
  if (!(QUERY_AUTH_MODES as readonly unknown[]).includes(input)) {
    throw new TypeError(
      "[better-convex-vue] defaultQueryAuth must be 'optional', 'required', or 'none'",
    )
  }
  return input as ConvexAuthMode
}

export type BetterConvexPlugin = ObjectPlugin & {
  /** Safe cross-framework attachment; available after plugin installation. */
  attachment(): BetterConvexAttachment
}

const BOOLEAN_CLIENT_OPTIONS = [
  'verbose',
  'skipConvexDeploymentUrlCheck',
  'unsavedChangesWarning',
] as const

/**
 * Copy only the supported `ConvexClient` options. JavaScript callers can pass
 * any object, so every accepted key is type-checked and every other key is
 * rejected rather than forwarded to the client.
 */
function normalizeClientOptions(
  input: BetterConvexClientOptions | undefined,
): BetterConvexClientOptions {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('[better-convex-vue] clientOptions must be an object')
  }
  const normalized: {
    -readonly [Key in keyof BetterConvexClientOptions]: BetterConvexClientOptions[Key]
  } = {}
  for (const key of Object.keys(input)) {
    const value = (input as Record<string, unknown>)[key]
    if (value === undefined) continue
    if ((BOOLEAN_CLIENT_OPTIONS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') {
        throw new TypeError(`[better-convex-vue] clientOptions.${key} must be a boolean`)
      }
      normalized[key as (typeof BOOLEAN_CLIENT_OPTIONS)[number]] = value
    } else if (key === 'webSocketConstructor') {
      if (typeof value !== 'function') {
        throw new TypeError(
          '[better-convex-vue] clientOptions.webSocketConstructor must be a WebSocket constructor',
        )
      }
      normalized.webSocketConstructor = value as typeof WebSocket
    } else {
      throw new TypeError(`[better-convex-vue] clientOptions.${key} is not supported`)
    }
  }
  return Object.freeze(normalized)
}

function makeClient(convexUrl: string, clientOptions: BetterConvexClientOptions) {
  return new ConvexClient(convexUrl, {
    unsavedChangesWarning: false,
    // Keep the confirmed first token until its scheduled refresh. Without it,
    // Convex fetches a second token at once, and because every session token
    // is unique, re-authenticates and re-runs every authenticated query.
    initialAuthTokenReuse: true,
    ...clientOptions,
  })
}

export function createBetterConvex(options: CreateBetterConvexOptions): BetterConvexPlugin {
  if (options.attachment !== undefined && options.clientOptions !== undefined) {
    throw new TypeError(
      '[better-convex-vue] clientOptions cannot be combined with attachment; the owning application configures its clients',
    )
  }
  const clientOptions =
    options.attachment !== undefined ? {} : normalizeClientOptions(options.clientOptions)
  const defaultQueryAuth = normalizeDefaultQueryAuth(options.defaultQueryAuth)
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
            clientFactory: () => makeClient(options.convexUrl!, clientOptions),
            auth: options.auth,
            keepAlive: options.experimental?.keepAlive,
          })
      ownedBrowser = browser
      const attachment = attached ?? browser!.attachment
      const installedBrowser = browser ?? createAttachedBrowserFacade(attachment)
      installedAttachment = attachment
      const identity = attachClientIdentity(attachment)
      const runtime: BetterConvexVueRuntime = Object.freeze({
        browser: installedBrowser,
        identity,
        defaultQueryAuth,
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
