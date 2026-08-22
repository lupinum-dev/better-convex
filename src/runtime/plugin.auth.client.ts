import { createBetterConvex } from '@lupinum/better-convex-vue'
import { createAuthClient } from 'better-auth/vue'
import { computed } from 'vue'

import { clearNuxtData, defineNuxtPlugin, useRuntimeConfig, useState } from '#app'
import convexAuthClientDefinition from '#convex/auth-client'

import { convexClientPlugin } from './auth-client/convex-client-plugin'
import {
  ANONYMOUS_IDENTITY,
  identityKeyOf,
  identityToken,
  identityUser,
  toAuthenticatedIdentity,
} from './auth/auth-identity'
import { createBetterAuthBrowserAdapter } from './auth/better-auth-browser-adapter'
import type { AuthClientWithConvex } from './auth/client-engine-types'
import { createIntegratedAuthClient } from './auth/integrated-client'
import { createAuthOperationTracker } from './auth/operation-tracker'
import {
  createSessionSynchronization,
  type ProviderSessionRevision,
} from './auth/session-synchronization'
import { validateConvexAuthClientDefinition } from './auth/validate-auth-client-definition'
import { setupNuxtDevtoolsClient } from './devtools/setup-client'
import type { ConvexCallError } from './errors'
import { createConvexRuntimeContext, type NuxtConvexAuthController } from './runtime-context'
import { useConvexIdentityState } from './utils/auth-identity-state'
import { useConvexAuthPendingState } from './utils/auth-pending-state'
import {
  purgeConvexIdentityPayloadKeys,
  readAuthMode,
  retainAnonymousConvexQueryErrors,
} from './utils/convex-cache'
import { createLogger, getLogLevel } from './utils/logger'
import { getConvexRuntimeConfig } from './utils/runtime-config'

const SESSION_RECONCILIATION_TIMEOUT_MS = 5_000
// Matches the Vue package's private, non-exported owner seam. Keeping this off
// the public plugin type prevents embedded children from gaining auth control.
const INTERNAL_REFRESH_AUTH = Symbol.for('better-convex-vue:internal-refresh-auth')

/** Auth-enabled entry: Better Auth is an adapter around the one Vue-owned runtime. */
export default defineNuxtPlugin({
  name: 'convex:auth-client',
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    const convexConfig = getConvexRuntimeConfig()
    if (convexConfig.auth === false) {
      throw new Error('[better-convex-nuxt] auth client plugin loaded in a no-auth build')
    }
    if (!convexConfig.url) return

    const publicConvex = config.public.convex as Record<string, unknown> | undefined
    const logger = createLogger(getLogLevel(publicConvex))
    const definitionOptions = validateConvexAuthClientDefinition(convexAuthClientDefinition)
    const { plugins: consumerPlugins, ...baseOptions } = definitionOptions
    const authClient = createAuthClient({
      ...baseOptions,
      baseURL: `${window.location.origin}/api/auth`,
      plugins: [convexClientPlugin(), ...(consumerPlugins ?? [])],
      fetchOptions: { credentials: 'include' },
    }) as unknown as AuthClientWithConvex

    const identity = useConvexIdentityState()
    const authError = useState<string | null>('convex:authError', () => null)
    const pendingState = useConvexAuthPendingState()
    let synchronization: ReturnType<typeof createSessionSynchronization> | null = null
    let latestProviderSession: ProviderSessionRevision | undefined
    let publishCurrentSessionAcceptance: () => void = () => {}
    const adapter = createBetterAuthBrowserAdapter(
      authClient,
      {
        authenticated(token, user) {
          identity.value = toAuthenticatedIdentity(token, user)
          authError.value = null
          pendingState.value = false
        },
        anonymous(error) {
          identity.value = ANONYMOUS_IDENTITY
          authError.value = error
          pendingState.value = false
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
      {
        initialIdentityKey:
          identity.value.status === 'authenticated' ? identity.value.user.id : undefined,
      },
    )

    const vuePlugin = createBetterConvex({
      convexUrl: convexConfig.url,
      auth: adapter,
    })
    nuxtApp.vueApp.use(vuePlugin)
    const runtime = createConvexRuntimeContext(vuePlugin.attachment(), logger)
    nuxtApp.provide('convexRuntime', runtime)
    const queryErrors = useState<Record<string, ConvexCallError | null>>(
      'convex:query-errors',
      () => ({}),
    )
    const ssrIdentityKey = identityKeyOf(identity.value)
    const initialSnapshot = runtime.attachment.identity.snapshot()
    let observedIdentityGeneration = initialSnapshot.identityGeneration
    let runtimeProviderRevision = adapter.snapshot().sessionGeneration
    let initialHydrationReconciled = false
    const purgeProtectedPayload = () => {
      purgeConvexIdentityPayloadKeys(nuxtApp)
      queryErrors.value = retainAnonymousConvexQueryErrors(queryErrors.value)
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
      if (snapshot.error) {
        identity.value = ANONYMOUS_IDENTITY
        authError.value = snapshot.error.message
        pendingState.value = false
      }
      publishCurrentSessionAcceptance()
    }
    const stopProtectedPayloadObservation =
      runtime.attachment.identity.subscribe(reconcileProtectedPayload)
    reconcileProtectedPayload()

    let disposed = false
    const operations = createAuthOperationTracker()
    const refreshConvexAuthentication = Reflect.get(vuePlugin, INTERNAL_REFRESH_AUTH)
    if (typeof refreshConvexAuthentication !== 'function') {
      throw new TypeError('[better-convex-nuxt] Vue auth refresh seam is unavailable')
    }
    synchronization = createSessionSynchronization({
      timeoutMs: SESSION_RECONCILIATION_TIMEOUT_MS,
      refetchCanonicalSession: () =>
        Reflect.apply(refreshConvexAuthentication, vuePlugin, []) as Promise<void>,
      failClosed(failure) {
        adapter.failClosed(failure.message)
      },
    })
    if (latestProviderSession) synchronization.observeProvider(latestProviderSession)
    // Seed already-settled SSR/browser identity so a Promise operation whose
    // canonical refetch finds the same session need not manufacture a new
    // Convex generation merely to prove an acceptance that already happened.
    reconcileProtectedPayload()
    const integratedClient = createIntegratedAuthClient(
      authClient,
      synchronization,
      operations.track,
    )

    const controller: NuxtConvexAuthController = {
      pending: computed(() => pendingState.value || operations.pending.value),
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
        if (!snapshot.settled) return 'loading'
        if (snapshot.error) return 'error'
        return snapshot.identityKey === 'anonymous' ? 'anonymous' : 'authenticated'
      },
      dispose() {
        if (disposed) return
        disposed = true
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
        token: computed(() => identityToken(identity.value)),
        user: computed(() => identityUser(identity.value)),
        waterfall,
        instanceId: instanceId.value,
        logger,
        onDispose: (dispose) => nuxtApp.vueApp.onUnmount(dispose),
      })
    }
  },
})
