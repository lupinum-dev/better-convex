import {
  queryIsolationTag,
  useBetterConvexIdentity,
  type ClientIdentitySnapshot,
  type ConvexArgsState,
} from '@lupinum/better-convex-vue/internal'
import { computed, onScopeDispose, shallowRef, watch, type ComputedRef } from 'vue'

import { onNuxtReady, useAsyncData, useNuxtApp, useRequestEvent, useState } from '#imports'

import { identityKeyOf, identityToken } from '../auth/auth-identity'
import { ConvexCallError, normalizeConvexError } from '../errors'
import { useConvexIdentityState } from './auth-identity-state'
import { useConvexAuthPendingState } from './auth-pending-state'
import type { ConvexAuthMode } from './auth-status'
import {
  fetchAuthToken,
  matchesConvexHydrationIdentity,
  type ConvexPayloadNamespace,
} from './convex-cache'
import {
  convexQueryAsyncDataKey,
  projectConvexSsrQuery,
  projectNuxtQueryIdentity,
  readConvexQueryPayload,
  resolveConvexQueryGate,
  sameConvexQueryGate,
  type ConvexQueryPayload,
  type ConvexSsrQueryView,
} from './query-ssr'
import { getConvexRuntimeConfig } from './runtime-config'
import type { ConvexServerConfig } from './transport-config'

/**
 * Nuxt's SSR-seeded auth state (`convex:pending` / `convex:identity` /
 * `convex:authError`) as the Vue identity snapshot. The server and a hydrating
 * browser read the same values, so both derive the same query gate. The live
 * browser lifecycle reads the Vue runtime identity instead.
 */
export function useConvexQueryIdentity(): ComputedRef<ClientIdentitySnapshot> {
  const authEnabled = getConvexRuntimeConfig().auth !== false
  const identity = useConvexIdentityState()
  const pending = useConvexAuthPendingState()
  const authError = useState<string | null>('convex:authError', () => null)
  return computed(() =>
    projectNuxtQueryIdentity({
      authEnabled,
      pending: pending.value,
      identityKey: identityKeyOf(identity.value),
      error: authError.value
        ? new ConvexCallError({
            kind: 'authentication',
            message: authError.value,
          })
        : null,
    }),
  )
}

/** The query boundary shared by the SSR render and the hydrating browser. */
export interface ConvexQueryBoundaryInput {
  readonly namespace: ConvexPayloadNamespace
  readonly functionName: string
  readonly auth: ConvexAuthMode
  readonly server: boolean
  readonly immediate: boolean
  readonly args: ConvexArgsState<unknown>
  /** Hash segment of the payload key for the current arguments. */
  readonly keyHash: () => string
}

export interface ConvexSsrQueryInput<T> extends ConvexQueryBoundaryInput {
  readonly lazy: boolean
  /** `bounds` are the configured `convex.server` limits for this request. */
  fetch(
    convexUrl: string,
    token: string | undefined,
    signal: AbortSignal | undefined,
    bounds: ConvexServerConfig,
  ): Promise<T>
}

export interface ConvexSsrQuery<T> {
  readonly view: ComputedRef<ConvexSsrQueryView<T>>
  /** Settles with the initial SSR fetch that this render waits for. */
  readonly settled: Promise<void>
  execute(): Promise<void>
  refresh(): Promise<void>
  /** Re-run the fetch for the current key without starting a deferred query. */
  reload(): Promise<void>
}

const ignore = () => {}

/** The SSR half of a query: one Nuxt async-data entry per identity-partitioned key. */
export function useConvexSsrQuery<T>(input: ConvexSsrQueryInput<T>): ConvexSsrQuery<T> {
  const { auth, server, immediate, lazy } = input
  const identity = useConvexQueryIdentity()
  const started = shallowRef(immediate)
  const gate = computed(() =>
    resolveConvexQueryGate({
      auth,
      started: started.value,
      skipped: input.args.args.value === 'skip',
      identity: identity.value,
    }),
  )
  const key = computed(() =>
    convexQueryAsyncDataKey(input.namespace, input.functionName, input.keyHash(), auth, gate.value),
  )
  const event = useRequestEvent()
  const identityState = useConvexIdentityState()
  const cachedToken = computed(() => identityToken(identityState.value))
  const { url: convexUrl, server: bounds } = getConvexRuntimeConfig()
  const asyncData = useAsyncData<ConvexQueryPayload<T> | null>(
    key,
    async () => {
      const decision = gate.value
      if (decision.outcome !== 'execute' || !convexUrl) return null
      try {
        const token = fetchAuthToken({
          auth,
          cookieHeader: event?.headers.get('cookie') ?? '',
          cachedToken,
        })
        if (auth !== 'none' && decision.identity !== 'anonymous' && !token) return null
        return {
          value: await input.fetch(convexUrl, token, event?.web?.request?.signal, bounds),
        }
      } catch (error) {
        return {
          error: normalizeConvexError(error, {
            functionName: input.functionName,
          }),
        }
      }
    },
    { server, immediate, lazy, deep: false, default: () => null },
  )
  const view = computed(() =>
    projectConvexSsrQuery({
      gate: gate.value,
      server,
      functionName: input.functionName,
      authError: identity.value.error,
      entry: asyncData.data.value,
      fetching: asyncData.status.value === 'pending',
    }),
  )
  return {
    view,
    settled:
      !lazy && immediate && server && gate.value.outcome !== 'idle'
        ? asyncData.then(ignore, ignore)
        : Promise.resolve(),
    async execute() {
      started.value = true
      await asyncData.execute().then(ignore, ignore)
    },
    async refresh() {
      started.value = true
      await asyncData.refresh().then(ignore, ignore)
    },
    async reload() {
      await asyncData.execute().then(ignore, ignore)
    },
  }
}

/** The live browser state the hydration boundary hands off to. */
export interface ConvexLiveQuery {
  readonly error: ComputedRef<unknown>
  readonly pending: ComputedRef<boolean>
  execute(): Promise<void>
}

export interface ConvexQueryHydration<T> {
  /** The SSR value the live lifecycle starts from. */
  readonly seed: { readonly value: T } | undefined
  /** Whether the live lifecycle must wait for Nuxt hydration to settle. */
  readonly defersLiveStart: boolean
  /** The server-rendered view, shown until the live lifecycle starts. */
  readonly view: ComputedRef<ConvexSsrQueryView<T> | undefined>
  /** The SSR error, bridged until the started live lifecycle settles. */
  readonly error: ComputedRef<ConvexCallError | undefined>
  /** Start a deferred live lifecycle once Nuxt hydration settles. */
  startLive(live: ConvexLiveQuery): void
  /** Stop showing the server-rendered view, for example after a caller reset. */
  retire(): void
}

/**
 * The browser half of a query's SSR boundary. It renders exactly what the
 * server rendered for as long as Nuxt hydrates, then hands off to the live
 * lifecycle. Like Nuxt's default `getCachedData`, the payload is read only
 * while hydrating: after hydration it describes an earlier page, not the data.
 */
export function useConvexQueryHydration<T>(
  input: ConvexQueryBoundaryInput,
): ConvexQueryHydration<T> {
  const nuxtApp = useNuxtApp()
  // Nuxt also reports `isHydrating` on the first render of an `ssr: false`
  // page. Nothing was rendered on the server there, so the query starts at
  // once and an awaited query waits for its browser result.
  if (!nuxtApp.isHydrating || !nuxtApp.payload.serverRendered || !input.immediate) {
    return {
      seed: undefined,
      defersLiveStart: false,
      view: computed(() => undefined),
      error: computed(() => undefined),
      startLive: ignore,
      retire: ignore,
    }
  }

  const { auth, server } = input
  const identity = useConvexQueryIdentity()
  const currentGate = () =>
    resolveConvexQueryGate({
      auth,
      started: true,
      skipped: input.args.args.value === 'skip',
      identity: identity.value,
    })
  const gate = currentGate()
  const argsHash = input.args.hash.value
  const browserIdentity = useBetterConvexIdentity()
  const browserTag = () => {
    const tag = queryIsolationTag(auth, browserIdentity.value)
    return `${tag.identityKey}:${tag.identityGeneration}`
  }
  const initialBrowserTag = browserTag()
  // A protected payload may seed only a browser identity that already names
  // the same principal; otherwise the browser renders as if nothing was fetched.
  const identityMatches =
    gate.outcome !== 'execute' ||
    matchesConvexHydrationIdentity(auth, gate.identity, browserIdentity.value)
  const entry =
    gate.outcome === 'execute' && identityMatches
      ? readConvexQueryPayload<T>(
          nuxtApp.payload.data[
            convexQueryAsyncDataKey(
              input.namespace,
              input.functionName,
              input.keyHash(),
              auth,
              gate,
            )
          ],
        )
      : undefined
  const ssrView = projectConvexSsrQuery({
    gate,
    server,
    functionName: input.functionName,
    authError: identity.value.error,
    entry,
    fetching: false,
  })

  const live = shallowRef(false)
  const retired = shallowRef(false)
  let disposed = false
  let stopBoundary: (() => void) | undefined
  let stopBridge: (() => void) | undefined
  const retire = () => {
    retired.value = true
    stopBoundary?.()
    stopBridge?.()
    stopBoundary = stopBridge = undefined
  }
  // Any argument, SSR auth, or browser identity change retires the boundary for good.
  stopBoundary = watch(
    () =>
      input.args.hash.value === argsHash &&
      sameConvexQueryGate(currentGate(), gate) &&
      browserTag() === initialBrowserTag,
    (matches) => {
      if (!matches) retire()
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    disposed = true
    retire()
  })

  return {
    // Seed only a value the server rendered, never one it merely shares a key with.
    seed: ssrView.status === 'success' ? { value: ssrView.value as T } : undefined,
    defersLiveStart: true,
    view: computed(() => (live.value || retired.value ? undefined : ssrView)),
    error: computed(() => (retired.value ? undefined : ssrView.error)),
    startLive(liveQuery) {
      onNuxtReady(() => {
        if (disposed) return
        void liveQuery.execute()
        live.value = true
        if (retired.value) return
        const liveSettled = () => liveQuery.error.value !== undefined || !liveQuery.pending.value
        if (liveSettled()) {
          retire()
          return
        }
        stopBridge = watch(
          liveSettled,
          (settled) => {
            if (settled) retire()
          },
          { flush: 'sync' },
        )
      })
    },
    retire,
  }
}
