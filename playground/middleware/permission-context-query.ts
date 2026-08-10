import { api } from '#convex/api'

/**
 * Playground example: query Convex inside Nuxt route middleware.
 *
 * Route middleware is a one-shot navigation guard:
 * - client navigation uses useConvex()
 * - SSR navigation uses serverConvex()
 */
export default defineNuxtRouteMiddleware(async () => {
  const context = import.meta.server
    ? await serverConvex(useRequestEvent()!).query(api.auth.getPermissionContext)
    : await useConvex().query(api.auth.getPermissionContext, {})

  // For the playground demo, just require an authenticated permission context.
  // (Some users may not have a DB user row yet on first sign-in, and the playground
  // auto-creates it after page load.)
  if (!context) {
    return navigateTo('/auth/signin')
  }
})
