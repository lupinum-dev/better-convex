import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '../..')

const appOwnedOrganizationStarters = ['agency'] as const

function readStarterFile(starter: string, path: string): string {
  return readFileSync(join(repoRoot, 'starters', starter, path), 'utf8')
}

describe('starter organization ownership', () => {
  it('requires verified email ownership before accepting organization invitations', () => {
    const starterAuth = readStarterFile('team', 'convex/auth.ts')
    const schemaPlugins = readStarterFile('team', 'convex/betterAuth/schemaPlugins.ts')
    const organizationGuide = readFileSync(
      join(repoRoot, 'docs/content/docs/5.recipes/6.organization-permissions.md'),
      'utf8',
    )

    expect(starterAuth).toContain('createTeamAuthPlugins(authIssuer')
    expect(schemaPlugins).toContain('requireEmailVerificationOnInvitation: true')
    expect(organizationGuide).toContain('requireEmailVerificationOnInvitation: true')
    expect(schemaPlugins).not.toContain('requireEmailVerificationOnInvitation: false')
    expect(organizationGuide).not.toMatch(/requireEmailVerificationOnInvitation:\s*process\.env/)
  })

  it('team uses Better Auth Organization as the organization source of truth', () => {
    const schema = readStarterFile('team', 'convex/schema.ts')
    const readme = readStarterFile('team', 'README.md')
    const auth = readStarterFile('team', 'convex/auth.ts')
    const schemaPlugins = readStarterFile('team', 'convex/betterAuth/schemaPlugins.ts')
    const organizationCreateForm = readStarterFile(
      'team',
      'app/components/OrganizationCreateForm.vue',
    )
    const organizationWorkspace = readStarterFile(
      'team',
      'app/components/OrganizationWorkspace.vue',
    )
    const projects = readStarterFile('team', 'convex/projects.ts')
    const authz = readStarterFile('team', 'convex/lib/authz.ts')
    const audit = readStarterFile('team', 'convex/lib/audit.ts')

    expect(schema).not.toContain('organizations: defineTable')
    expect(schema).not.toContain('memberships: defineTable')
    expect(schema).not.toContain('invitations: defineTable')
    expect(schema).not.toContain('pluginProjects: defineTable')
    expect(schema).not.toContain('pluginAuditEvents: defineTable')
    expect(schema).toContain('projects: defineTable')
    expect(schema).toContain('auditEvents: defineTable')
    expect(schema).toContain('organizationId: v.string()')
    expect(schema).toContain('createdByAuthUserId: v.string()')
    expect(schema).toContain('actor: auditActor')
    expect(schema).toContain('authUserId: v.string()')
    expect(readme).toContain('Better Auth Organization with static roles.')
    expect(readme).toMatch(
      /source for organization,\s+member,\s+invitation,\s+team,\s+and team-member state/,
    )
    expect(auth).toContain('createTeamAuthPlugins(authIssuer')
    expect(schemaPlugins).toMatch(/\borganization\s*\(/)
    expect(schemaPlugins).toContain("from 'better-auth/plugins'")
    expect(organizationCreateForm).toContain('api.organizations.create')
    expect(organizationCreateForm).not.toContain('authClient.organization.create')
    expect(organizationWorkspace).toContain('api.organizations.listMine')
    expect(organizationWorkspace).not.toContain('useTeamOrganizations')
    expect(authz).toContain('authComponent.safeGetAuthUser(ctx)')
    expect(authz).toContain('roleAllowsOrganizationPermissions')
    expect(authz).toContain('getBetterAuthMember(ctx')
    expect(projects).toContain('requireProjectTeamAccess')
    expect(projects).toContain('requireProjectAccessById')
    expect(projects).toContain("query('projects')")
    expect(projects).toContain("insert('projects'")
    expect(projects).toContain('writeAuditEvent')
    expect(audit).toContain("insert('auditEvents'")
    expect(projects).not.toContain('requireOrgAccess')
  })

  it.each(appOwnedOrganizationStarters)(
    '%s keeps app-owned organizations separate from Better Auth Organization',
    (starter) => {
      const schema = readStarterFile(starter, 'convex/schema.ts')
      const readme = readStarterFile(starter, 'README.md')
      const auth = tryReadStarterAuth(starter)

      expect(schema).toContain('organizations: defineTable')
      expect(schema).toContain('memberships: defineTable')
      expect(readme).toContain('app-owned Convex')
      expect(readme).toMatch(/does not enable the Better Auth Organization\s+plugin/)
      expect(auth).not.toMatch(/\borganization\s*\(/)
      expect(auth).not.toMatch(
        /import\s*\{[^}]*\borganization\b[^}]*\}\s*from 'better-auth\/plugins'/,
      )
    },
  )
})

function tryReadStarterAuth(starter: string): string {
  try {
    return readStarterFile(starter, 'convex/auth.ts')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}
