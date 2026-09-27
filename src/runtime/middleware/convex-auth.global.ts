import { defineNuxtRouteMiddleware, navigateTo, useRuntimeConfig } from '#app'

import { useConvexAuth } from '../composables/useConvexAuth'
import {
  resolveRouteProtectionDecision,
  type ConvexAuthPageMeta,
} from '../utils/auth-route-protection'
import { normalizeConvexRuntimeConfig } from '../utils/runtime-config'

const PROTECTED_ROUTE_AUTH_SETTLE_TIMEOUT_MS = 5_000

export default defineNuxtRouteMiddleware(async (to) => {
  const authConfig = normalizeConvexRuntimeConfig(useRuntimeConfig().public.convex).auth
  if (authConfig === false) return

  const pageMeta = to.meta as { convexAuth?: ConvexAuthPageMeta }

  const { status, pending, ready } = useConvexAuth()

  const decision = resolveRouteProtectionDecision({
    meta: pageMeta.convexAuth,
    defaultRedirectTo: authConfig.redirectTo,
    currentPath: to.path,
    currentFullPath: to.fullPath,
  })

  if (!decision) return

  // For protected routes, wait for auth state to settle to avoid protected-content flashes.
  if (import.meta.client && pending.value) {
    const settledStatus = await ready({
      timeoutMs: PROTECTED_ROUTE_AUTH_SETTLE_TIMEOUT_MS,
    })
    if (settledStatus === 'authenticated') return
  }

  // The server never waits: SSR already resolved auth, so a still-pending
  // server state falls through to the secure default below.
  if (status.value === 'authenticated') return
  return navigateTo(decision.redirectTo)
})
