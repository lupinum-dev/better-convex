import { defineNuxtRouteMiddleware, navigateTo, useRequestEvent, useRuntimeConfig } from '#app'

import { useConvexActivation } from '../composables/useConvexActivation'
import { useConvexAuth } from '../composables/useConvexAuth'
import {
  resolveGuestRedirect,
  resolveRoutePolicy,
  resolveRouteProtectionDecision,
  type ConvexAuthPageMeta,
} from '../utils/auth-route-protection'
import { AUTH_UNAVAILABLE_MESSAGE } from '../utils/convex-shared'
import { normalizeConvexRuntimeConfig } from '../utils/runtime-config'
import { isSsrAuthEnabled } from '../utils/ssr-auth'

const ROUTE_AUTH_SETTLE_TIMEOUT_MS = 5_000

export default defineNuxtRouteMiddleware(async (to) => {
  const authConfig = normalizeConvexRuntimeConfig(useRuntimeConfig().public.convex).auth
  if (authConfig === false) return

  const meta = (to.meta as { convexAuth?: ConvexAuthPageMeta }).convexAuth
  const policy = resolveRoutePolicy(meta, authConfig.routes)
  if (policy === 'public') return
  // Without SSR auth the server does not know the visitor, so the browser decides.
  if (import.meta.server && !isSsrAuthEnabled(useRequestEvent()?.context, authConfig.ssr)) return

  // An on-demand build starts the browser runtime for the first page that
  // needs to know who is signed in.
  if (import.meta.client) await useConvexActivation().activate()
  const { status, pending, error, ready } = useConvexAuth()

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

  if ((await settledStatus()) === 'authenticated' || status.value === 'authenticated') return
  // The server or the browser could not ask Better Auth for this person (a 429,
  // 5xx, timeout or network error; a 401 is not an error here). That is
  // "unknown", not "signed out": render the page with `status: 'error'`, or
  // still `'pending'` while the browser waits out the failure after a server
  // render that hit it. The browser keeps retrying and recovers on its own;
  // Convex still refuses data the person may not read.
  if (
    error.value?.message === AUTH_UNAVAILABLE_MESSAGE &&
    (status.value === 'error' || status.value === 'pending')
  ) {
    return
  }
  // Any other pending or failed state falls through to the secure default.
  return navigateTo(decision.redirectTo)
})
