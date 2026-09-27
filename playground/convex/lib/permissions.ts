/**
 * Backend Permission Helpers
 *
 * Server-side utilities that use the permission config. Provides getUser,
 * requireUser, and authorize for a minimal "signed-in + ownership" model.
 *
 * Unauthorized errors are thrown as structured ConvexError values so the
 * client can distinguish authentication from authorization failures:
 *   - { code: 'UNAUTHENTICATED' } → not signed in
 *   - { code: 'FORBIDDEN' }       → signed in but not allowed
 */

import { ConvexError } from 'convex/values'

import type { Id } from '../_generated/dataModel'
import type { QueryCtx, MutationCtx } from '../_generated/server'
import { auth } from '../auth'
import {
  checkPermission,
  type Permission,
  type PermissionContext,
  type Resource,
} from '../permissions.config'

// ============================================
// AUTH USER TYPE
// ============================================

export interface AuthUser {
  _id: Id<'users'>
  authId: string
  displayName?: string
  email?: string
}

// ============================================
// GET USER
// ============================================
// Returns the current user projection or null if not signed in.

export async function getUser(ctx: QueryCtx | MutationCtx): Promise<AuthUser | null> {
  // auth.getUser checks the live Better Auth session, not only the token.
  const authUser = await auth.getUser(ctx)
  if (!authUser) {
    return null
  }

  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', authUser.id))
    .first()

  if (!user) {
    return null
  }

  return user as AuthUser
}

// ============================================
// REQUIRE USER
// ============================================
// Like getUser, but throws a structured UNAUTHENTICATED error.

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthUser> {
  const user = await getUser(ctx)
  if (!user) {
    throw new ConvexError({ code: 'UNAUTHENTICATED', message: 'Not authenticated' })
  }
  return user
}

// ============================================
// AUTHORIZE
// ============================================
// The main security gate. Use in EVERY mutation.
//
//   await authorize(ctx, 'post.create')          // signed-in check
//   await authorize(ctx, 'post.update', post)    // ownership check

export async function authorize(
  ctx: QueryCtx | MutationCtx,
  permission: Permission,
  resource?: Resource,
): Promise<AuthUser> {
  const user = await requireUser(ctx)

  const permCtx: PermissionContext = { role: 'member', userId: user.authId }

  if (!checkPermission(permCtx, permission, resource)) {
    throw new ConvexError({ code: 'FORBIDDEN', message: `Forbidden: ${permission}` })
  }

  return user
}
