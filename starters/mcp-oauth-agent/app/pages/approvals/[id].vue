<script setup lang="ts">
import { api } from '#convex/api'

defineOptions({ name: 'AgentRequestPage' })

// The link an agent gives you in the chat: the one request, and what became of it.
const route = useRoute()
const id = computed(() => String(route.params.id))
const { status, user, client } = useConvexAuth()
const { data: request, status: loading } = await useConvexQuery(
  api.agents.get,
  computed(() => (status.value === 'authenticated' ? { approvalId: id.value } : 'skip')),
  { auth: 'required', server: false },
)
const failure = ref('')
const approve = useConvexMutation(api.agents.approve)
const decline = useConvexMutation(api.agents.decline)
const deciding = computed(() => approve.pending.value || decline.pending.value)

async function decide(choice: 'approve' | 'decline') {
  failure.value = ''
  try {
    if (choice === 'decline') await decline.mutate({ approvalId: id.value })
    else {
      const outcome = await approve.mutate({ approvalId: id.value })
      // The request can fail when the project changed after the agent asked.
      if (outcome.status === 'failed') failure.value = outcome.error.message
    }
  } catch (error) {
    const data = (error as { data?: { message?: unknown } }).data
    failure.value =
      typeof data?.message === 'string' ? data.message : 'That did not work. Try again.'
  }
}

const signInLink = computed(() => `/?return=${encodeURIComponent(route.fullPath)}`)
async function switchAccount() {
  await client.signOut().catch(() => {})
  await navigateTo(signInLink.value)
}

const outcome = {
  approved: 'Approved. The agent can continue.',
  declined: 'Declined. The agent is told.',
  expired: 'This request expired before anyone decided. Ask the agent again if it is still needed.',
  cancelled: 'This request was cancelled: the agent stopped or was disconnected.',
  failed: 'It could not be done.',
} as const
</script>

<template>
  <main>
    <section class="card attention">
      <h1>Agent request</h1>
      <p v-if="status === 'loading' || (status === 'authenticated' && loading === 'pending')">
        Loading…
      </p>
      <p v-else-if="status !== 'authenticated'">
        <NuxtLink :to="signInLink">Sign in</NuxtLink> to see this request. You come back here
        afterwards.
      </p>
      <template v-else-if="!request">
        <p>
          This request is not for {{ user?.email ?? 'this account' }}, or it does not exist. If an
          agent asked you, sign in with the account that connected the agent.
        </p>
        <div class="row">
          <button type="button" class="secondary" @click="switchAccount">
            Use another account
          </button>
        </div>
      </template>
      <template v-else>
        <p class="text">{{ request.summary }}</p>
        <p v-if="!request.mine" class="muted">
          A teammate's agent asked. You may decide because of your role.
        </p>
        <template v-if="request.status === 'pending'">
          <div class="row">
            <button type="button" :disabled="deciding" @click="decide('approve')">Approve</button>
            <button type="button" class="secondary" :disabled="deciding" @click="decide('decline')">
              Decline
            </button>
          </div>
          <small class="muted"
            >Open until
            {{
              new Date(request.expiresAt).toLocaleTimeString(undefined, { timeStyle: 'short' })
            }}.</small
          >
        </template>
        <p v-else role="status">
          {{ outcome[request.status] }}
          <template v-if="request.status === 'failed' && request.error">
            {{ request.error.message }}</template
          >
        </p>
        <p v-if="failure" class="problem" role="alert">{{ failure }}</p>
      </template>
    </section>
  </main>
</template>
