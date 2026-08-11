<script setup lang="ts">
import type { OrganizationRole } from '~~/shared/organizationRoles'
import { organizationRoles } from '~~/shared/organizationRoles'

import type { Member } from '~/utils/organizationModels'

defineProps<{
  canManageMembers?: boolean
  members: readonly Member[]
  selectedTeamMemberUserIds: Set<string>
  membersPending: boolean
  membersError: string | null
  hasMore: boolean
  memberLabel: (member: Member) => string
  onChangeRole: (member: Member, role: OrganizationRole) => void
  onAddToTeam: (member: Member) => void
  onRemoveFromTeam: (member: Member) => void
  onRemoveMember: (member: Member) => void
  onLoadMore: () => void
}>()

function formatRole(role: OrganizationRole) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
</script>

<template>
  <section v-if="canManageMembers" class="activity">
    <h2>Members</h2>
    <section v-if="membersPending" class="empty">Loading members...</section>
    <section v-else-if="membersError" class="empty">{{ membersError }}</section>
    <ul v-else-if="members.length" class="items-list">
      <li v-for="member in members" :key="member.id">
        <span>{{ memberLabel(member) }}</span>
        <select
          :value="member.role"
          @change="
            onChangeRole(member, ($event.target as HTMLSelectElement).value as OrganizationRole)
          "
        >
          <option v-for="role in organizationRoles" :key="role" :value="role">
            {{ formatRole(role) }}
          </option>
        </select>
        <button
          v-if="!selectedTeamMemberUserIds.has(member.userId)"
          class="button"
          @click="onAddToTeam(member)"
        >
          Add to team
        </button>
        <button v-else class="button" @click="onRemoveFromTeam(member)">Remove from team</button>
        <button class="button" @click="onRemoveMember(member)">Remove</button>
      </li>
    </ul>
    <section v-else class="empty">No members yet.</section>
    <button v-if="hasMore" class="button" type="button" @click="onLoadMore">Load more</button>
  </section>
</template>
