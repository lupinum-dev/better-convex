import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '../..')

function readStarterFile(starter: string, path: string): string {
  return readFileSync(join(repoRoot, 'starters', starter, path), 'utf8')
}

describe('starter organization ownership', () => {
  it('requires verified email ownership before accepting organization invitations', () => {
    const starterAuth = readStarterFile('team', 'convex/auth.ts')
    const schemaPlugins = readStarterFile('team', 'convex/betterAuth/schemaPlugins.ts')
    const organizationGuide = readFileSync(
      join(repoRoot, 'docs/content/docs/4.recipes/6.organization-permissions.md'),
      'utf8',
    )

    expect(starterAuth).toContain('organization: createTeamOrganizationOptions(),')
    expect(schemaPlugins).toContain('requireEmailVerificationOnInvitation: true')
    expect(organizationGuide).toContain('requireEmailVerificationOnInvitation: true')
    expect(schemaPlugins).not.toContain('requireEmailVerificationOnInvitation: false')
    expect(organizationGuide).not.toMatch(/requireEmailVerificationOnInvitation:\s*process\.env/)
  })
})
