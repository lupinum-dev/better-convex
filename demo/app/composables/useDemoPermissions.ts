/**
 * Demo Permissions Composable
 *
 * Keeps demo permission policy in application code. The module intentionally
 * does not own an authorization runtime.
 */

import { api } from '@@/convex/_generated/api'
import { checkPermission, type Permission, type Resource } from '@@/convex/permissions.config'

// Re-export types
export type { Permission, Resource }

/**
 * Access permission context and check permissions
 *
 * @example
 * ```vue
 * <script setup>
 * const { can, user, role, isAuthenticated, pending } = await useDemoPermissions()
 * </script>
 *
 * <template>
 *   <button v-if="can('feed.create')">Create Post</button>
 *   <span>Current role: {{ role }}</span>
 * </template>
 * ```
 */
export async function useDemoPermissions() {
  const { data: context, status } = await useConvexQuery(api.auth.getPermissionContext, {})

  function can(permission: Permission, resource?: Resource): boolean {
    return checkPermission(context.value ?? null, permission, resource)
  }

  return {
    can,
    user: computed(() => context.value),
    role: computed(() => context.value?.role ?? null),
    isAuthenticated: computed(() => Boolean(context.value)),
    pending: computed(() => status.value === 'pending'),
  }
}
