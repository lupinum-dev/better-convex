/**
 * Permission Configuration for Convex Labs
 *
 * Simplified permission system for demo purposes. The demo returns a fixed
 * member context and does not model authoritative roles or organizations.
 *
 * UI hints only. The Convex functions in this demo do NOT read this table and do not enforce it.
 * Hiding a button is not authorization. A real application must check the role in every Convex
 * function, for example with `authorize()` in `playground/convex/lib/permissions.ts`.
 */

export const ROLES = ['admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_INFO: Record<
  Role,
  { label: string; icon: string; color: string; description: string }
> = {
  admin: {
    label: 'Admin',
    icon: 'i-lucide-shield',
    color: 'blue',
    description: 'Full access to everything',
  },
  member: {
    label: 'Member',
    icon: 'i-lucide-user',
    color: 'green',
    description: 'Create and edit own content',
  },
  viewer: {
    label: 'Viewer',
    icon: 'i-lucide-eye',
    color: 'gray',
    description: 'View content only',
  },
}

/**
 * Permission definitions
 * Each permission can have:
 * - roles: array of roles that have this permission
 * - own: array of roles that can perform on their own resources
 * - any: array of roles that can perform on any resource
 */
export const permissions = {
  // Global permissions
  global: {
    'admin.settings': { roles: ['admin'] as const },
    'view.all': { roles: ['admin', 'member', 'viewer'] as const },
  },
  // Feed permissions
  feed: {
    create: { roles: ['admin', 'member'] as const },
    read: { roles: ['admin', 'member', 'viewer'] as const },
    delete: { own: ['member'] as const, any: ['admin'] as const },
  },
  // Task permissions
  task: {
    create: { roles: ['admin', 'member'] as const },
    update: { own: ['member', 'viewer'] as const, any: ['admin'] as const },
    delete: { own: ['member'] as const, any: ['admin'] as const },
  },
  // File permissions
  file: {
    upload: { roles: ['admin', 'member'] as const },
    delete: { own: ['member'] as const, any: ['admin'] as const },
  },
} as const

// All possible permission strings
export type Permission =
  | keyof typeof permissions.global
  | `feed.${keyof typeof permissions.feed}`
  | `task.${keyof typeof permissions.task}`
  | `file.${keyof typeof permissions.file}`

/**
 * Permission context returned from the server
 */
export interface PermissionContext {
  role: Role
  userId: string
  displayName?: string
  email?: string
  avatarUrl?: string
}

/**
 * Resource interface for ownership checks
 */
export interface Resource {
  ownerId?: string
}

/**
 * Check if a user has a specific permission
 */
export function checkPermission(
  ctx: PermissionContext | null,
  permission: Permission,
  resource?: Resource,
): boolean {
  if (!ctx) return false

  // Check global permissions
  if (permission in permissions.global) {
    const rule = permissions.global[permission as keyof typeof permissions.global]
    return (rule.roles as readonly string[]).includes(ctx.role)
  }

  // Parse permission string (e.g., "feed.create" -> ["feed", "create"])
  const [resourceType, action] = permission.split('.') as [string, string]
  const resourcePerms = permissions[resourceType as keyof typeof permissions]

  if (!resourcePerms || resourceType === 'global') return false

  const rule = (resourcePerms as Record<string, unknown>)[action] as
    | { roles?: readonly string[]; own?: readonly string[]; any?: readonly string[] }
    | undefined

  if (!rule) return false

  // Simple role check
  if ('roles' in rule && rule.roles) {
    return rule.roles.includes(ctx.role)
  }

  // Check 'any' permission first (can do to any resource)
  if ('any' in rule && rule.any?.includes(ctx.role)) {
    return true
  }

  // Check 'own' permission (can only do to own resources)
  if ('own' in rule && rule.own?.includes(ctx.role)) {
    if (!resource) return false
    return resource.ownerId === ctx.userId
  }

  return false
}
