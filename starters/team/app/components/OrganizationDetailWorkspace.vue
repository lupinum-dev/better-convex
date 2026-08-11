<script setup lang="ts">
import {
  cancelInvitationInputSchema,
  changeMemberRoleInputSchema,
  createTeamInputSchema,
  inviteMemberInputSchema,
  removeMemberInputSchema,
  renameOrganizationInputSchema,
  renameTeamInputSchema,
  teamMembershipInputSchema,
} from '~~/shared/inputSchemas'
import type { InviteRole, OrganizationRole } from '~~/shared/organizationRoles'

import { api } from '#convex/api'
import type {
  Member,
  OrganizationSummary,
  PendingInvitation,
  Team,
} from '~/utils/organizationModels'

const props = defineProps<{
  organization: OrganizationSummary
}>()

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

const organizationId = computed(() => props.organization.id)
const selectedTeamId = ref<string | null>(null)
const createTeamMutation = useConvexMutation(api.organizations.createTeam)
const renameOrganizationMutation = useConvexMutation(api.organizations.rename)
const renameTeamMutation = useConvexMutation(api.teams.rename)
const inviteMemberMutation = useConvexMutation(api.organizations.inviteMember)
const cancelInvitationMutation = useConvexMutation(api.organizations.cancelInvitation)
const changeRoleMutation = useConvexMutation(api.organizations.changeMemberRole)
const removeMemberMutation = useConvexMutation(api.organizations.removeMember)
const addTeamMemberMutation = useConvexMutation(api.teams.addMember)
const removeTeamMemberMutation = useConvexMutation(api.teams.removeMember)

const { data: orgCapabilities } = await useConvexQuery(api.organizations.getCapabilities, () => ({
  organizationId: organizationId.value,
}))
const {
  data: teamsData,
  pending: teamsPending,
  error: teamsQueryError,
} = await useConvexQuery(api.organizations.listTeams, () => ({
  organizationId: organizationId.value,
}))
const {
  data: membersData,
  isLoading: membersPending,
  error: membersQueryError,
  canLoadMore: hasMoreMembers,
  loadMore: loadMoreMembers,
} = await useConvexPaginatedQuery(
  api.organizations.listMembers,
  () =>
    orgCapabilities.value?.canManageMembers
      ? {
          organizationId: organizationId.value,
          teamId: selectedTeamId.value ?? undefined,
        }
      : 'skip',
  { initialNumItems: 25, auth: 'required' },
)
const {
  data: invitationsData,
  isLoading: invitationsPending,
  error: invitationsQueryError,
  canLoadMore: hasMoreInvitations,
  loadMore: loadMoreInvitations,
} = await useConvexPaginatedQuery(
  api.organizations.listInvitations,
  () =>
    orgCapabilities.value?.canManageMembers ? { organizationId: organizationId.value } : 'skip',
  { initialNumItems: 25, auth: 'required' },
)

const teamName = ref('')
const teamRenameName = ref('')
const teamCreatePending = ref(false)
const teamCreateError = ref<string | null>(null)
const orgName = ref(props.organization.name)
const orgRenamePending = ref(false)
const orgRenameError = ref<string | null>(null)
const teamRenamePending = ref(false)
const teamRenameError = ref<string | null>(null)
const invitePending = ref(false)
const inviteError = ref<string | null>(null)
const cancelInvitationEmail = ref<string | null>(null)

const teams = computed(() => teamsData.value ?? [])
const members = computed(() => membersData.value ?? [])
const invitations = computed<readonly PendingInvitation[]>(() => invitationsData.value ?? [])
const teamsError = computed(() =>
  teamsQueryError.value ? errorMessage(teamsQueryError.value, 'Teams could not be loaded') : null,
)
const membersError = computed(() =>
  membersQueryError.value
    ? errorMessage(membersQueryError.value, 'Members could not be loaded')
    : null,
)
const invitationsError = computed(() =>
  invitationsQueryError.value
    ? errorMessage(invitationsQueryError.value, 'Invitations could not be loaded')
    : null,
)
const selectedTeam = computed<Team | null>(
  () => teams.value.find((team) => team.id === selectedTeamId.value) ?? null,
)

watch(
  teams,
  (nextTeams) => {
    if (!selectedTeamId.value || !nextTeams.some((team) => team.id === selectedTeamId.value)) {
      selectedTeamId.value = nextTeams[0]?.id ?? null
    }
  },
  { immediate: true },
)

watch(
  selectedTeam,
  (team) => {
    teamRenameName.value = team?.name ?? ''
  },
  { immediate: true },
)

watch(
  () => props.organization.name,
  (nextName) => {
    orgName.value = nextName
  },
)

async function createTeam() {
  const parsed = createTeamInputSchema.safeParse({
    organizationId: organizationId.value,
    name: teamName.value,
  })
  if (!parsed.success) {
    teamCreateError.value = parsed.error.issues[0]?.message ?? 'Team was not created'
    return
  }

  teamCreatePending.value = true
  teamCreateError.value = null
  try {
    const team = await createTeamMutation(parsed.data)
    teamName.value = ''
    selectedTeamId.value = team.id
  } catch (error) {
    teamCreateError.value = errorMessage(error, 'Team was not created')
  } finally {
    teamCreatePending.value = false
  }
}

async function renameOrganization() {
  const parsed = renameOrganizationInputSchema.safeParse({
    organizationId: organizationId.value,
    name: orgName.value,
  })
  if (!parsed.success) {
    orgRenameError.value = parsed.error.issues[0]?.message ?? 'Organization was not renamed'
    return
  }
  if (parsed.data.name === props.organization.name) return

  orgRenamePending.value = true
  orgRenameError.value = null
  try {
    await renameOrganizationMutation(parsed.data)
  } catch (error) {
    orgRenameError.value = errorMessage(error, 'Organization was not renamed')
  } finally {
    orgRenamePending.value = false
  }
}

async function renameSelectedTeam() {
  if (!selectedTeam.value) return

  const parsed = renameTeamInputSchema.safeParse({
    teamId: selectedTeam.value.id,
    name: teamRenameName.value,
  })
  if (!parsed.success) {
    teamRenameError.value = parsed.error.issues[0]?.message ?? 'Team was not renamed'
    return
  }
  if (parsed.data.name === selectedTeam.value.name) return

  teamRenamePending.value = true
  teamRenameError.value = null
  try {
    await renameTeamMutation(parsed.data)
  } catch (error) {
    teamRenameError.value = errorMessage(error, 'Team was not renamed')
  } finally {
    teamRenamePending.value = false
  }
}

async function inviteMember(email: string, role: InviteRole) {
  const parsed = inviteMemberInputSchema.safeParse({
    organizationId: organizationId.value,
    email,
    role,
    teamId: selectedTeamId.value ?? undefined,
  })
  if (!parsed.success) {
    inviteError.value = parsed.error.issues[0]?.message ?? 'Member was not invited'
    return false
  }

  invitePending.value = true
  inviteError.value = null
  try {
    await inviteMemberMutation(parsed.data)
    return true
  } catch (error) {
    inviteError.value = errorMessage(error, 'Member was not invited')
    return false
  } finally {
    invitePending.value = false
  }
}

async function cancelInvitation(email: string) {
  const parsed = cancelInvitationInputSchema.safeParse({
    organizationId: organizationId.value,
    email,
  })
  if (!parsed.success) return

  cancelInvitationEmail.value = email
  try {
    await cancelInvitationMutation(parsed.data)
  } finally {
    cancelInvitationEmail.value = null
  }
}

async function changeMemberRole(member: Member, role: OrganizationRole) {
  if (role === member.role) return
  const parsed = changeMemberRoleInputSchema.safeParse({
    organizationId: organizationId.value,
    memberId: member.id,
    role,
  })
  if (!parsed.success) return

  await changeRoleMutation(parsed.data)
}

async function removeMember(member: Member) {
  const parsed = removeMemberInputSchema.safeParse({
    organizationId: organizationId.value,
    memberId: member.id,
  })
  if (!parsed.success) return

  await removeMemberMutation(parsed.data)
}

async function addMemberToSelectedTeam(member: Member) {
  if (!selectedTeamId.value) return
  const parsed = teamMembershipInputSchema.safeParse({
    teamId: selectedTeamId.value,
    userId: member.userId,
  })
  if (!parsed.success) return

  await addTeamMemberMutation(parsed.data)
}

async function removeMemberFromSelectedTeam(member: Member) {
  if (!selectedTeamId.value) return
  const parsed = teamMembershipInputSchema.safeParse({
    teamId: selectedTeamId.value,
    userId: member.userId,
  })
  if (!parsed.success) return

  await removeTeamMemberMutation(parsed.data)
}

function memberLabel(member: Member) {
  if (member.user?.name && member.user.email) {
    return `${member.user.name} <${member.user.email}>`
  }
  return member.user?.name || member.user?.email || member.userId
}
</script>

<template>
  <OrganizationAdminPanel
    v-model:selected-team-id="selectedTeamId"
    v-model:org-name="orgName"
    v-model:team-name="teamName"
    v-model:team-rename-name="teamRenameName"
    :organization="organization"
    :role="orgCapabilities?.role"
    :can-manage-organization="orgCapabilities?.canManageOrganization"
    :can-manage-teams="orgCapabilities?.canManageTeams"
    :teams="teams"
    :selected-team="selectedTeam"
    :teams-pending="teamsPending"
    :teams-error="teamsError"
    :org-rename-pending="orgRenamePending"
    :org-rename-error="orgRenameError"
    :team-rename-pending="teamRenamePending"
    :team-rename-error="teamRenameError"
    :team-create-pending="teamCreatePending"
    :team-create-error="teamCreateError"
    :on-rename-organization="renameOrganization"
    :on-rename-team="renameSelectedTeam"
    :on-create-team="createTeam"
  />

  <SelectedTeamWorkspace
    v-if="selectedTeam"
    :key="selectedTeam.id"
    :organization-id="organizationId"
    :team-id="selectedTeam.id"
    :members="members"
    :selected-team-name="selectedTeam.name"
    :invitations="invitations"
    :invitations-pending="invitationsPending"
    :invitations-error="invitationsError"
    :invitations-have-more="hasMoreInvitations"
    :invite-pending="invitePending || cancelInvitationEmail !== null"
    :invite-error="inviteError"
    :members-pending="membersPending"
    :members-error="membersError"
    :members-have-more="hasMoreMembers"
    :can-manage-members="orgCapabilities?.canManageMembers"
    :member-label="memberLabel"
    :on-invite="inviteMember"
    :on-cancel-invitation="cancelInvitation"
    :on-load-more-invitations="() => loadMoreInvitations(25)"
    :on-change-role="changeMemberRole"
    :on-add-to-team="addMemberToSelectedTeam"
    :on-remove-from-team="removeMemberFromSelectedTeam"
    :on-remove-member="removeMember"
    :on-load-more-members="() => loadMoreMembers(25)"
  />

  <OrganizationAuditSection
    v-if="orgCapabilities?.canViewOrgActivity"
    :organization-id="organizationId"
  />
</template>
