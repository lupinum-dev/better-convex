<script setup lang="ts">
import { normalizeLocalCallbackURL } from '~~/shared/inputSchemas'

import { api } from '#convex/api'

const route = useRoute()
const invitationId = computed(() => route.params.invitationId as string)
const { status, error: authError, user } = useConvexAuth()
const acceptInvitation = useConvexMutation(api.invitations.accept)
const rejectInvitation = useConvexMutation(api.invitations.reject)
const shouldLoadInvitation = computed(
  () => status.value === 'authenticated' && user.value?.emailVerified === true,
)
const {
  data: invitation,
  pending: invitationPending,
  error: invitationError,
} = await useConvexQuery(api.invitations.get, () =>
  shouldLoadInvitation.value ? { invitationId: invitationId.value } : 'skip',
)

const actionPending = ref<'accept' | 'reject' | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const verificationPending = ref(false)
const verificationError = ref<string | null>(null)
const verificationMessage = ref<string | null>(null)

async function resendVerificationEmail() {
  if (!user.value?.email) return

  verificationPending.value = true
  verificationError.value = null
  verificationMessage.value = null
  try {
    await $fetch('/api/auth/send-verification-email', {
      method: 'POST',
      body: {
        email: user.value.email,
        callbackURL: normalizeLocalCallbackURL(route.fullPath),
      },
    })
    verificationMessage.value = 'Verification email sent.'
  } catch (error) {
    verificationError.value =
      error instanceof Error ? error.message : 'Verification email was not sent'
  } finally {
    verificationPending.value = false
  }
}

async function accept() {
  actionPending.value = 'accept'
  actionError.value = null
  actionMessage.value = null
  try {
    const result = await acceptInvitation({
      invitationId: invitationId.value,
    })
    await navigateTo(`/organizations/${result.organizationId}`)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Invitation was not accepted'
  } finally {
    actionPending.value = null
  }
}

async function reject() {
  actionPending.value = 'reject'
  actionError.value = null
  actionMessage.value = null
  try {
    await rejectInvitation({
      invitationId: invitationId.value,
    })
    actionMessage.value = 'Invitation rejected.'
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Invitation was not rejected'
  } finally {
    actionPending.value = null
  }
}
</script>

<template>
  <main class="shell">
    <NuxtLink class="back-link" to="/">Organizations</NuxtLink>
    <section class="header">
      <p>Organization invitation</p>
      <h1>Join an organization</h1>
    </section>

    <section v-if="status === 'loading'" class="empty">Checking session...</section>

    <section v-else-if="status === 'error'" class="empty">
      {{ authError?.message ?? 'Authentication failed.' }}
    </section>

    <AuthPanel
      v-else-if="status === 'anonymous'"
      message="Sign in or create an account with the invited email address to continue."
    />

    <section v-else-if="!user?.emailVerified" class="activity">
      <h2>Verify your email first</h2>
      <p>Signed in as {{ user?.email }}</p>
      <p>
        Invitation acceptance requires a verified email address that matches the invited address.
      </p>
      <p v-if="verificationMessage" class="empty">{{ verificationMessage }}</p>
      <p v-if="verificationError" class="empty">{{ verificationError }}</p>
      <button class="button" :disabled="verificationPending" @click="resendVerificationEmail">
        {{ verificationPending ? 'Sending...' : 'Resend verification email' }}
      </button>
    </section>

    <section v-else-if="invitationPending" class="empty">Loading invitation...</section>

    <section v-else-if="invitationError" class="empty">
      {{ invitationError instanceof Error ? invitationError.message : 'Invitation not available.' }}
    </section>

    <section v-else-if="actionMessage" class="empty">{{ actionMessage }}</section>

    <section v-else-if="invitation" class="activity">
      <h2>{{ invitation.organizationName }}</h2>
      <p>Signed in as {{ invitation.email }}</p>
      <p>Role: {{ invitation.role }}</p>
      <p v-if="invitation.teamName">Team: {{ invitation.teamName }}</p>
      <p>Status: {{ invitation.status }}</p>
      <p>Expires at {{ new Date(invitation.expiresAt).toUTCString() }}</p>

      <p v-if="actionError" class="empty">{{ actionError }}</p>

      <div class="toolbar">
        <button class="button" :disabled="actionPending !== null" @click="accept">
          {{ actionPending === 'accept' ? 'Accepting...' : 'Accept invitation' }}
        </button>
        <button class="button" :disabled="actionPending !== null" @click="reject">
          {{ actionPending === 'reject' ? 'Rejecting...' : 'Reject invitation' }}
        </button>
      </div>
    </section>
  </main>
</template>
