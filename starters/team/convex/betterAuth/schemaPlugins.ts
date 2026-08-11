import { jwt, createAccessControl, organization } from 'better-auth/plugins'

import type { OrganizationRole } from '../../shared/organizationRoles'

const accessControl = createAccessControl({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update'],
  project: ['create', 'read', 'update', 'delete'],
})

const ownerRole = accessControl.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update'],
  project: ['create', 'read', 'update', 'delete'],
})

const adminRole = accessControl.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update'],
  project: ['create', 'read', 'update', 'delete'],
})

const memberRole = accessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  project: ['create', 'read', 'update'],
})

const viewerRole = accessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  project: ['read'],
})

const organizationRoleConfig = {
  owner: ownerRole,
  admin: adminRole,
  member: memberRole,
  viewer: viewerRole,
} satisfies Record<
  OrganizationRole,
  typeof ownerRole | typeof adminRole | typeof memberRole | typeof viewerRole
>

export type OrganizationPermissionRequest = Partial<{
  organization: 'update'[]
  member: ('create' | 'update' | 'delete')[]
  invitation: ('create' | 'cancel')[]
  team: ('create' | 'update')[]
  project: ('create' | 'read' | 'update' | 'delete')[]
}>

export function roleAllowsOrganizationPermissions(
  role: string,
  permissions: OrganizationPermissionRequest,
): boolean {
  const definition = organizationRoleConfig[role as keyof typeof organizationRoleConfig]
  return definition?.authorize(permissions).success === true
}

type OrganizationOptions = NonNullable<Parameters<typeof organization>[0]>

export function createTeamAuthPlugins(
  authIssuer: string,
  callbacks: Pick<OrganizationOptions, 'sendInvitationEmail'> = {},
) {
  return [
    organization({
      ac: accessControl,
      roles: organizationRoleConfig,
      requireEmailVerificationOnInvitation: true,
      teams: { enabled: true },
      ...callbacks,
    }),
    jwt({
      disableSettingJwtHeader: true,
      jwks: {
        disablePrivateKeyEncryption: false,
        gracePeriod: 21 * 60,
        keyPairConfig: { alg: 'RS256' },
      },
      jwt: { audience: authIssuer, expirationTime: '10m', issuer: authIssuer },
    }),
  ]
}
