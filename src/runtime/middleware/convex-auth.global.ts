import { defineNuxtRouteMiddleware, navigateTo, useRuntimeConfig } from '#app'

import { useConvexAuth } from '../composables/useConvexAuth'
import {
  resolveGuestRedirect,
  resolveRoutePolicy,
  resolveRouteProtectionDecision,
  type ConvexAuthPageMeta,
} from '../utils/auth-route-protection'
import { normalizeConvexRuntimeConfig } from '../utils/runtime-config'

const ROUTE_AUTH_SETTLE_TIMEOUT_MS = 5_000

export default defineNuxtRouteMiddleware(async (to) => {
  const authConfig = normalizeConvexRuntimeConfig(useRuntimeConfig().public.convex).auth
  if (authConfig === false) return

  const meta = (to.meta as { convexAuth?: ConvexAuthPageMeta }).convexAuth
  const policy = resolveRoutePolicy(meta, authConfig.routes)
  if (policy === 'public') return

  const { status, pending, ready } = useConvexAuth()

  // Wait for auth to settle in the browser so neither a protected page nor a
  // guest page flashes for the wrong visitor. The server never waits: SSR
  // already resolved auth, and both sides then apply the same decision.
  const settledStatus = async () => {
    if (import.meta.client && pending.value) {
      return ready({ timeoutMs: ROUTE_AUTH_SETTLE_TIMEOUT_MS })
    }
    return status.value
  }

  if (policy === 'guest') {
    if ((await settledStatus()) !== 'authenticated') return
    const target = resolveGuestRedirect({
      returnTo: to.query.redirect,
      guestRedirectTo: authConfig.guestRedirectTo,
      currentPath: to.path,
    })
    return target ? navigateTo(target) : undefined
  }

  const decision = resolveRouteProtectionDecision({
    meta,
    routes: authConfig.routes,
    defaultRedirectTo: authConfig.redirectTo,
    currentPath: to.path,
    currentFullPath: to.fullPath,
  })
  if (!decision) return

  // A still-pending server state falls through to the secure default below.
  if ((await settledStatus()) === 'authenticated' || status.value === 'authenticated') return
  return navigateTo(decision.redirectTo)
})
