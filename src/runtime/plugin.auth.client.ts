import { createBetterConvex } from '@lupinum/better-convex-vue'
import { refreshBetterConvexAuth } from '@lupinum/better-convex-vue/internal'
import { createAuthClient } from 'better-auth/vue'
import { computed, shallowRef } from 'vue'

import { clearNuxtData, defineNuxtPlugin, useRuntimeConfig, useState, type NuxtApp } from '#app'
import convexAuthClientDefinition from '#convex/auth-client'

import { convexClientPlugin } from './auth-client/convex-client-plugin'
import {
  ANONYMOUS_IDENTITY,
  identityKeyOf,
  identityUser,
  toAuthenticatedIdentity,
} from './auth/auth-identity'
import { createBetterAuthBrowserAdapter } from './auth/better-auth-browser-adapter'
import type { AuthClientWithConvex } from './auth/client-engine-types'
import { createIntegratedAuthClient } from './auth/integrated-client'
import {
  BETTER_AUTH_SESSION_SIGNAL_DELAY_MS,
  createSessionSynchronization,
  readBetterAuthSessionSignal,
  type ProviderSessionRevision,
} from './auth/session-synchronization'
import { validateConvexAuthClientDefinition } from './auth/validate-auth-client-definition'
import { setupNuxtDevtoolsClient } from './devtools/setup-client'
import {
  createConvexRuntimeContext,
  readConvexRuntimeContext,
  type NuxtConvexAuthController,
} from './runtime-context'
import { useConvexIdentityState } from './utils/auth-identity-state'
import { useConvexAuthPendingState } from './utils/auth-pending-state'
import { purgeConvexIdentityPayloadKeys, readAuthMode } from './utils/convex-cache'
import { MISSING_CONVEX_URL_MESSAGE } from './utils/convex-config'
import { createLogger, getLogLevel } from './utils/logger'
import { getConvexRuntimeConfig } from './utils/runtime-config'
import type { ConvexUser } from './utils/types'

const SESSION_RECONCILIATION_TIMEOUT_MS = 5_000

/**
 * Start the auth-enabled browser runtime: Better Auth is an adapter around the
 * one Vue-owned runtime. The plugin below calls it at app start; with
 * `client.connect: 'on-demand'`, `useConvexActivation()` calls it inside the
 * Nuxt app context instead.
 */
export function setupConvexBrowserRuntime(nuxtApp: NuxtApp): void {
  const config = useRuntimeConfig()
  const convexConfig = getConvexRuntimeConfig()
  if (convexConfig.auth === false) {
    throw new Error(
      '[better-convex-nuxt] `convex.auth` is build-time configuration. This build includes authentication, but the runtime config disables it; NUXT_PUBLIC_CONVEX_AUTH* environment overrides are not supported. Set `convex.auth` in nuxt.config and rebuild.',
    )
  }
  if (readConvexRuntimeContext(nuxtApp)) return
  if (!convexConfig.url) {
    console.error(`[better-convex-nuxt] ${MISSING_CONVEX_URL_MESSAGE}`)
    return
  }

  const publicConvex = config.public.convex as Record<string, unknown> | undefined
  const logger = createLogger(getLogLevel(publicConvex))
  const definitionOptions = validateConvexAuthClientDefinition(convexAuthClientDefinition)
  const { plugins: consumerPlugins, ...baseOptions } = definitionOptions
  let synchronization: ReturnType<typeof createSessionSynchronization> | null = null
  const authClient = createAuthClient({
    ...baseOptions,
    baseURL: `${window.location.origin}/api/auth`,
    plugins: [
      convexClientPlugin({
        observeRequest: (routePath) => synchronization?.observeRequest(routePath),
      }),
      ...(consumerPlugins ?? []),
    ],
    fetchOptions: { credentials: 'include' },
  }) as unknown as AuthClientWithConvex

  const identity = useConvexIdentityState()
  const authError = useState<string | null>('convex:authError', () => null)
  const pendingState = useConvexAuthPendingState()
  // DevTools shows token expiry. The token stays out of the identity state,
  // which the server serializes into the page payload.
  const devtoolsToken = shallowRef<string | null>(null)
  let latestProviderSession: ProviderSessionRevision | undefined
  // The principal the server rendered this page for: its user ID, or `null`
  // for a settled anonymous render. Unknown (`undefined`) for an `ssr: false`
  // page or an unsettled or failed server auth check.
  const serverRenderedPrincipal = (): string | null | undefined => {
    if (identity.value.status === 'authenticated') return identity.value.user.id
    if (!nuxtApp.payload.serverRendered || pendingState.value || authError.value) return undefined
    return null
  }
  let publishCurrentSessionAcceptance: () => void = () => {}
  let publishAcceptedIdentity: () => void = () => {}
  // The provider's latest result, held until Convex accepts it. Nuxt shows a
  // new identity only after the Vue runtime confirms that Convex accepted the
  // token, so `useConvexAuth()` and `ready()` never disagree. Profile fields of
  // the identity already shown may update before a refreshed token is confirmed.
  let staged: { user: ConvexUser; token: string } | { user: null; error: string | null } | null =
    null
  const adapter = createBetterAuthBrowserAdapter(
    authClient,
    {
      authenticated(token, user) {
        staged = { user, token }
        publishAcceptedIdentity()
      },
      anonymous(error) {
        staged = { user: null, error }
        publishAcceptedIdentity()
      },
      sessionChanged(sessionToken, errorMessage, revision) {
        // The Better Auth cookie changing is necessary but not sufficient:
        // the Vue runtime must still fetch and have Convex accept its JWT.
        // Reconciliation is published from the settled runtime snapshot
        // below so integrated auth cannot resolve in that security gap.
        latestProviderSession = {
          sessionToken: errorMessage ? null : sessionToken,
          revision,
          failed: errorMessage !== null,
        }
        synchronization?.observeProvider(latestProviderSession)
        // A matching SSR-provisional generation can already be settled when
        // Better Auth publishes its canonical token later. The generation
        // guard inside this callback prevents a new session from inheriting
        // the prior runtime's settled state.
        publishCurrentSessionAcceptance()
      },
    },
    { initialIdentityKey: serverRenderedPrincipal() },
  )

  const vuePlugin = createBetterConvex({
    convexUrl: convexConfig.url,
    auth: adapter,
    clientOptions: convexConfig.client,
    experimental: { keepAlive: convexConfig.experimental?.keepAlive },
    defaultQueryAuth: convexConfig.auth.defaultQueryAuth,
  })
  nuxtApp.vueApp.use(vuePlugin)
  const runtime = createConvexRuntimeContext(vuePlugin.attachment(), logger)
  nuxtApp.provide('convexRuntime', runtime)
  const ssrIdentityKey = identityKeyOf(identity.value)
  const initialSnapshot = runtime.attachment.identity.snapshot()
  let observedIdentityGeneration = initialSnapshot.identityGeneration
  let runtimeProviderRevision = adapter.snapshot().sessionGeneration
  let initialHydrationReconciled = false
  // Query values and SSR errors share their identity-partitioned payload keys.
  const purgeProtectedPayload = () => {
    purgeConvexIdentityPayloadKeys(nuxtApp)
    clearNuxtData((key) => {
      const mode = readAuthMode(key)
      return mode === 'required' || mode === 'optional'
    })
  }
  publishCurrentSessionAcceptance = () => {
    const snapshot = runtime.attachment.identity.snapshot()
    if (
      snapshot.settled &&
      latestProviderSession &&
      latestProviderSession.revision === runtimeProviderRevision
    ) {
      synchronization?.observeAccepted(latestProviderSession, Boolean(snapshot.error))
    }
  }
  const reconcileProtectedPayload = () => {
    const snapshot = runtime.attachment.identity.snapshot()
    const generation = snapshot.identityGeneration
    // Attachment notifications are emitted synchronously from the adapter
    // transition. Capturing the adapter revision here binds this settled
    // runtime generation to the exact provider generation that produced it.
    runtimeProviderRevision = adapter.snapshot().sessionGeneration
    if (!initialHydrationReconciled) {
      if (snapshot.identityKey !== ssrIdentityKey) {
        initialHydrationReconciled = true
        purgeProtectedPayload()
      } else if (snapshot.settled) {
        initialHydrationReconciled = true
      }
    } else if (generation !== observedIdentityGeneration) {
      purgeProtectedPayload()
    }

    observedIdentityGeneration = generation
    publishAcceptedIdentity()
    publishCurrentSessionAcceptance()
  }
  publishAcceptedIdentity = () => {
    const snapshot = runtime.attachment.identity.snapshot()
    // Until the runtime settles, keep what is shown: the server-rendered
    // identity while hydrating, or the previous settled identity during a
    // sign-in, sign-out, or user switch.
    if (!snapshot.settled) return
    if (snapshot.error) {
      identity.value = ANONYMOUS_IDENTITY
      devtoolsToken.value = null
      authError.value = snapshot.error.message
    } else if (snapshot.identityKey === 'anonymous') {
      identity.value = ANONYMOUS_IDENTITY
      devtoolsToken.value = null
      authError.value = staged && staged.user === null ? staged.error : null
    } else {
      const accepted = staged?.user && toAuthenticatedIdentity(staged.user)
      if (accepted && identityKeyOf(accepted) === snapshot.identityKey) {
        identity.value = accepted
        devtoolsToken.value = staged?.user ? staged.token : null
      } else if (identityKeyOf(identity.value) !== snapshot.identityKey) {
        // Accepted before the provider's user arrived and not the identity
        // already shown: wait for the matching provider result.
        return
      }
      authError.value = null
    }
    pendingState.value = false
  }
  const stopProtectedPayloadObservation =
    runtime.attachment.identity.subscribe(reconcileProtectedPayload)
  reconcileProtectedPayload()

  let disposed = false
  const sessionSignal = readBetterAuthSessionSignal(authClient)
  synchronization = createSessionSynchronization({
    timeoutMs: SESSION_RECONCILIATION_TIMEOUT_MS,
    refetchCanonicalSession: () => refreshBetterConvexAuth(vuePlugin),
    failClosed(failure) {
      adapter.failClosed(failure.message)
    },
    // Without an observable signal every Promise operation reconciles.
    sessionSignalDelayMs: sessionSignal ? BETTER_AUTH_SESSION_SIGNAL_DELAY_MS : null,
  })
  const stopSessionSignal =
    sessionSignal?.listen(() => synchronization?.observeSessionSignal()) ?? (() => {})
  if (latestProviderSession) synchronization.observeProvider(latestProviderSession)
  // Seed already-settled SSR/browser identity so a Promise operation whose
  // canonical refetch finds the same session need not manufacture a new
  // Convex generation merely to prove an acceptance that already happened.
  reconcileProtectedPayload()
  const integratedClient = createIntegratedAuthClient(authClient, synchronization)

  const controller: NuxtConvexAuthController = {
    client: integratedClient,
    async ready(options) {
      const ready = runtime.attachment.identity.waitForInitialSettlement()
      const timeoutMs = options?.timeoutMs ?? 0
      if (timeoutMs <= 0) await ready
      else {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, timeoutMs)
          void ready.then(
            () => {
              clearTimeout(timer)
              resolve()
            },
            (error) => {
              clearTimeout(timer)
              reject(error)
            },
          )
        })
      }
      const snapshot = runtime.attachment.identity.snapshot()
      if (!snapshot.settled) return 'pending'
      if (snapshot.error) return 'error'
      return snapshot.identityKey === 'anonymous' ? 'anonymous' : 'authenticated'
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopSessionSignal()
      synchronization?.dispose()
      adapter.dispose()
    },
  }
  runtime.attachAuthController(controller)
  nuxtApp.vueApp.onUnmount(() => {
    stopProtectedPayloadObservation()
    runtime.dispose()
  })

  if (typeof window !== 'undefined' && import.meta.dev) {
    const waterfall = useState('convex:authWaterfall', () => null)
    const instanceId = useState<string>(
      'convex:devtoolsInstanceId',
      () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    )
    setupNuxtDevtoolsClient({
      runtime,
      token: devtoolsToken,
      user: computed(() => identityUser(identity.value)),
      waterfall,
      instanceId: instanceId.value,
      logger,
      readAuthState: () => ({
        isAuthenticated: identity.value.status === 'authenticated',
        pending: pendingState.value,
      }),
      onDispose: (dispose) => nuxtApp.vueApp.onUnmount(dispose),
    })
  }
}

/** Starts the browser runtime with the app (`client.connect: 'eager'`). */
export default defineNuxtPlugin({
  name: 'convex:auth-client',
  setup: setupConvexBrowserRuntime,
})
