import { z } from 'zod'

import { inviteRoles, organizationRoles } from './organizationRoles'

const organizationNameSchema = z
  .string()
  .trim()
  .min(1, 'Organization name is required')
  .max(120, 'Organization name is too long')

const teamNameSchema = z
  .string()
  .trim()
  .min(1, 'Team name is required')
  .max(120, 'Team name is too long')

const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Project name is required')
  .max(120, 'Project name is too long')

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('A valid email is required')
  .transform((value) => value.toLowerCase())

const personNameSchema = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long')

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The code has six digits')

const callbackBase = 'https://better-convex-nuxt.invalid'

function hasAsciiControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export function normalizeLocalCallbackURL(value: string): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    hasAsciiControl(value)
  ) {
    return '/'
  }

  try {
    const parsed = new URL(value, callbackBase)
    if (
      parsed.origin !== callbackBase ||
      !parsed.pathname.startsWith('/') ||
      parsed.pathname.startsWith('//') ||
      parsed.pathname.includes('\\') ||
      hasAsciiControl(parsed.pathname)
    ) {
      return '/'
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/'
  }
}

const optionalIdSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value)

const inviteRoleSchema = z.enum(inviteRoles)
const organizationRoleSchema = z.enum(organizationRoles)

export const createOrganizationInputSchema = z.object({
  name: organizationNameSchema,
})

export const renameOrganizationInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  name: organizationNameSchema,
})

export const createTeamInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  name: teamNameSchema,
})

export const renameTeamInputSchema = z.object({
  teamId: z.string().min(1, 'Team is required'),
  name: teamNameSchema,
})

export const createProjectInputSchema = z.object({
  teamId: z.string().min(1, 'Team is required'),
  name: projectNameSchema,
})

export const renameProjectInputSchema = z.object({
  projectId: z.string().min(1, 'Project is required'),
  name: projectNameSchema,
})

export const inviteMemberInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  email: emailSchema,
  role: inviteRoleSchema,
  teamId: optionalIdSchema.optional(),
})

export const cancelInvitationInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  email: emailSchema,
})

export const changeMemberRoleInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  memberId: z.string().trim().min(1, 'Member is required'),
  role: organizationRoleSchema,
})

export const removeMemberInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  memberId: z.string().trim().min(1, 'Member is required'),
})

export const teamMembershipInputSchema = z.object({
  teamId: z.string().min(1, 'Team is required'),
  userId: z.string().trim().min(1, 'User is required'),
})

export const sendCodeInputSchema = z.object({
  email: emailSchema,
})

export const signInWithCodeInputSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  otp: codeSchema,
})
