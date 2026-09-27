import { computed, type ComputedRef } from 'vue'

import { useRoute } from '#imports'

import { normalizeLocalRedirectPath } from '../utils/auth-route-protection'

/**
 * The validated `?redirect=` return path that protected-route middleware adds
 * when it sends a visitor to sign in, or `null` when it is missing, repeated,
 * or not a safe same-origin application path. Navigate here after sign-in.
 */
export function useConvexAuthReturnTo(): ComputedRef<string | null> {
  const route = useRoute()
  return computed(() => normalizeLocalRedirectPath(route.query.redirect))
}
