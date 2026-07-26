import type { ComputedRef, Ref } from 'vue'

import { useState, computed, readonly, ref, useNuxtApp } from '#imports'

import type { BaseAuthClient, InferRegisteredConvexAuthClient } from '../auth-client'
import { identityKeyOf, identityToken, identityUser } from '../auth/auth-identity'
import { ConvexCallError } from '../errors'
import { readConvexRuntimeContext } from '../runtime-context'
import { useConvexIdentityState } from '../utils/auth-identity-state'
import { deriveConvexAuthStatus, type ConvexAuthStatus } from '../utils/auth-status'
import { getConvexRuntimeConfig } from '../utils/runtime-config'
import type { ConvexUser } from '../utils/types'

// Re-export for convenience
export type { ConvexUser } from '../utils/types'

interface AuthClientNamespaceContract {
  readonly signIn: unknown
  readonly signUp: unknown
}

/** The integrated `signIn` namespace type — structurally the client's own. */
export type IntegratedSignIn<Client extends AuthClientNamespaceContract = BaseAuthClient> =
  Client['signIn']
/** The integrated `signUp` namespace type — structurally the client's own. */
export type IntegratedSignUp<Client extends AuthClientNamespaceContract = BaseAuthClient> =
  Client['signUp']

/**
 * The Convex authentication contract . `status` describes current
 * usable identity; `isPending` describes auth work in flight — deliberately
 * independent.
 */
export interface UseConvexAuthReturn<Client extends AuthClientNamespaceContract = BaseAuthClient> {
  status: ComputedRef<ConvexAuthStatus>
  isPending: ComputedRef<boolean>
  isAuthenticated: ComputedRef<boolean>
  user: Readonly<Ref<ConvexUser | null>>
  token: Readonly<Ref<string | null>>
  error: Readonly<Ref<ConvexCallError | null>>
  signIn: IntegratedSignIn<Client>
  signUp: IntegratedSignUp<Client>
  signOut: () => Promise<unknown>
  refresh: () => Promise<void>
  ready: (options?: { timeoutMs?: number }) => Promise<ConvexAuthStatus>
  client: Client | null
}

function createAuthDisabledError(): ConvexCallError {
  return new ConvexCallError({
    kind: 'authentication',
    message:
      '[useConvexAuth] Authentication is disabled for this build (auth: false). Enable auth to use signIn/signUp/signOut/refresh.',
  })
}

/**
 * A namespace whose every callable rejects. Used for the disabled build and as
 * the client-only fallback before the auth client exists.
 */
function createInertAuthNamespace<T>(name: 'signIn' | 'signUp', message: string): T {
  const build = (path: string[]): unknown => {
    const fn = () => {}
    return new Proxy(fn, {
      get(_t, prop) {
        if (prop === 'then') return undefined
        if (typeof prop === 'symbol') return undefined
        return build([...path, prop])
      },
      apply() {
        if (import.meta.dev) console.warn(message)
        return Promise.reject(new Error(message))
      },
    })
  }
  return build([name]) as T
}

// Module-scoped immutable disabled refs hold no app-specific
// state and never mutate, so one shared instance per module is allowed.
const DISABLED_STATUS = computed<ConvexAuthStatus>(() => 'disabled')
const DISABLED_IS_PENDING = computed(() => false)
const DISABLED_IS_AUTHENTICATED = computed(() => false)
const DISABLED_USER = readonly(ref<ConvexUser | null>(null))
const DISABLED_TOKEN = readonly(ref<string | null>(null))
const DISABLED_ERROR = readonly(ref<ConvexCallError | null>(null))
const DISABLED_SIGN_IN = createInertAuthNamespace<UseConvexAuthReturn['signIn']>(
  'signIn',
  '[useConvexAuth] signIn is unavailable because auth is disabled for this build.',
)
const DISABLED_SIGN_UP = createInertAuthNamespace<UseConvexAuthReturn['signUp']>(
  'signUp',
  '[useConvexAuth] signUp is unavailable because auth is disabled for this build.',
)

function createDisabledAuthResult(): UseConvexAuthReturn {
  return {
    status: DISABLED_STATUS,
    isPending: DISABLED_IS_PENDING,
    isAuthenticated: DISABLED_IS_AUTHENTICATED,
    user: DISABLED_USER,
    token: DISABLED_TOKEN,
    error: DISABLED_ERROR,
    signIn: DISABLED_SIGN_IN,
    signUp: DISABLED_SIGN_UP,
    signOut: async () => {
      throw createAuthDisabledError()
    },
    refresh: async () => {
      throw createAuthDisabledError()
    },
    ready: async () => 'disabled',
    client: null,
  }
}

/**
 * Access Convex authentication state . Auto-imported unconditionally
 * and safe to call before the auth plugin runs (SSR / early setup): reactive
 * state comes from the SSR-seeded `useState` refs, and operations delegate to the
 * per-app coordinator when it exists (browser only).
 *
 * @example
 * ```vue
 * <script setup>
 * const { user, status, signIn, signOut } = useConvexAuth()
 * </script>
 * ```
 */
export function useConvexAuth(): UseConvexAuthReturn<InferRegisteredConvexAuthClient> {
  const authEnabled = getConvexRuntimeConfig().auth !== false
  if (!authEnabled) {
    return createDisabledAuthResult() as unknown as UseConvexAuthReturn<InferRegisteredConvexAuthClient>
  }

  const nuxtApp = useNuxtApp()
  const identity = useConvexIdentityState()
  const token = computed(() => identityToken(identity.value))
  const user = computed(() => identityUser(identity.value))
  const authError = useState<string | null>('convex:authError', () => null)
  const pending = useState<boolean>('convex:pending', () => import.meta.client)

  const coordinator = readConvexRuntimeContext(nuxtApp)?.getAuthController() ?? undefined
  const client = ((nuxtApp as { $auth?: unknown }).$auth ??
    null) as InferRegisteredConvexAuthClient | null

  const status = computed<ConvexAuthStatus>(() => {
    return deriveConvexAuthStatus({
      authEnabled: true,
      settled: !pending.value,
      identityKey: identityKeyOf(identity.value),
      error: authError.value
        ? new ConvexCallError({ kind: 'authentication', message: authError.value })
        : null,
    })
  })
  const isAuthenticated = computed(() => identity.value.status === 'authenticated')
  const isPending = coordinator ? coordinator.isPending : computed(() => pending.value)
  const error = computed<ConvexCallError | null>(() =>
    authError.value
      ? new ConvexCallError({ kind: 'authentication', message: authError.value })
      : null,
  )

  const requireCoordinator = (label: string) => {
    if (!coordinator) {
      throw new Error(
        `[useConvexAuth] ${label} is client-only — call it from a browser event handler after the auth plugin has initialized.`,
      )
    }
    return coordinator
  }

  const signIn = (coordinator?.integratedSignIn ??
    createInertAuthNamespace(
      'signIn',
      '[useConvexAuth] signIn is client-only; call it from a browser event handler.',
    )) as IntegratedSignIn<InferRegisteredConvexAuthClient>
  const signUp = (coordinator?.integratedSignUp ??
    createInertAuthNamespace(
      'signUp',
      '[useConvexAuth] signUp is client-only; call it from a browser event handler.',
    )) as IntegratedSignUp<InferRegisteredConvexAuthClient>

  return {
    status,
    isPending,
    isAuthenticated,
    user: readonly(user),
    token: readonly(token),
    error: error as Readonly<Ref<ConvexCallError | null>>,
    signIn,
    signUp,
    signOut: () => requireCoordinator('signOut()').signOut(),
    refresh: () => requireCoordinator('refresh()').refresh(),
    ready: async (options) => {
      if (!coordinator) return status.value
      return coordinator.ready(options)
    },
    client,
  }
}
