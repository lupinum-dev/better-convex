/**
 * Auth middleware for protected routes
 *
 * Redirects unauthenticated users to sign-in page.
 */
export default defineNuxtRouteMiddleware(() => {
  const { status } = useConvexAuth()

  // Wait for auth to load
  if (status.value === 'loading') {
    return
  }

  // Redirect to login if not authenticated
  if (status.value !== 'authenticated') {
    return navigateTo('/')
  }
})
