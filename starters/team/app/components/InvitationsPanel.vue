<script setup lang="ts">
import type { InviteRole } from '~~/shared/organizationRoles'
import { inviteRoles } from '~~/shared/organizationRoles'

import { formatAuditTimestamp } from '~/utils/formatTime'
import type { PendingInvitation } from '~/utils/organizationModels'

const inviteEmail = ref('')
const inviteRole = ref<InviteRole>('member')

const props = defineProps<{
  canManageMembers?: boolean
  selectedTeamName?: string
  invitations: readonly PendingInvitation[]
  invitationsPending: boolean
  invitationsError: string | null
  hasMore: boolean
  invitePending: boolean
  inviteError: string | null
  onInvite: (email: string, role: InviteRole) => Promise<boolean> | boolean
  onCancelInvitation: (email: string) => Promise<void> | void
  onLoadMore: () => void
}>()

function formatRole(role: InviteRole) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

async function inviteMember() {
  const email = inviteEmail.value.trim()
  if (!email) return

  const invited = await props.onInvite(email, inviteRole.value)
  if (invited) {
    inviteEmail.value = ''
  }
}
</script>

<template>
  <section v-if="canManageMembers" class="activity">
    <h2>Invitations</h2>
    <form class="toolbar" @submit.prevent="inviteMember">
      <input v-model="inviteEmail" placeholder="Invite by email" :disabled="invitePending" />
      <select v-model="inviteRole" :disabled="invitePending">
        <option v-for="role in inviteRoles" :key="role" :value="role">
          {{ formatRole(role) }}
        </option>
      </select>
      <button class="button" type="submit" :disabled="invitePending || !inviteEmail.trim()">
        {{ invitePending ? 'Inviting...' : 'Invite' }}
      </button>
    </form>
    <section v-if="selectedTeamName" class="empty">
      New invites join {{ selectedTeamName }} when accepted.
    </section>
    <section v-if="inviteError" class="empty">{{ inviteError }}</section>
    <section v-if="invitationsPending" class="empty">Loading invitations...</section>
    <section v-else-if="invitationsError" class="empty">{{ invitationsError }}</section>
    <ul v-else-if="invitations.length" class="items-list">
      <li v-for="invitation in invitations" :key="invitation.email">
        <span>
          {{ invitation.email }}
          ({{ formatRole(invitation.role) }}
          <template v-if="invitation.teamName">, {{ invitation.teamName }}</template
          >)
        </span>
        <span>Expires {{ formatAuditTimestamp(invitation.expiresAt) }}</span>
        <button class="button" @click="onCancelInvitation(invitation.email)">Cancel</button>
      </li>
    </ul>
    <section v-else class="empty">No pending invitations.</section>
    <button v-if="hasMore" class="button" type="button" @click="onLoadMore">Load more</button>
  </section>
</template>
