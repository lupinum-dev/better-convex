<script setup lang="ts">
import { api } from '#convex/api'

const { status, error: authError, client } = useConvexAuth()
const connectionArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))
const { data: connections } = await useConvexQuery(api.connections.list, connectionArgs, {
  auth: 'required',
  server: false,
})
const { mutate: revoke, pending: revoking } = useConvexMutation(api.connections.revoke)
// Rounded up to the minute, so a request leaves the list before it expires.
const minute = 60_000
const nextMinute = () => Math.ceil(Date.now() / minute) * minute
const now = ref(nextMinute())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => (clock = setInterval(() => (now.value = nextMinute()), minute)))
onUnmounted(() => clearInterval(clock))
const approvalArgs = computed(() =>
  status.value === 'authenticated' ? { now: now.value } : 'skip',
)
const { data: approvals } = await useConvexQuery(api.approvals.listPending, approvalArgs, {
  auth: 'required',
  server: false,
})
const approve = useConvexMutation(api.approvals.approveProjectDelete)
const reject = useConvexMutation(api.approvals.rejectProjectDelete)
const deciding = computed(() => approve.pending.value || reject.pending.value)
const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <main>
    <h1>MCP connections</h1>
    <p v-if="status === 'pending'">Checking session…</p>
    <p v-else-if="status === 'error'">
      {{ authError?.message ?? 'Authentication failed.' }}
    </p>
    <template v-else-if="status === 'authenticated'">
      <section v-if="approvals?.length" aria-label="Deletion requests">
        <h2>Waiting for your approval</h2>
        <ul>
          <li v-for="approval in approvals" :key="approval.id">
            Delete project <strong>{{ approval.projectName }}</strong> in
            {{ approval.organizationName }}. Requested by {{ approval.requestedBy }} through an MCP
            host; expires at {{ formatTime(approval.expiresAt) }}.
            <button
              type="button"
              :disabled="deciding"
              @click="approve.mutate({ approvalId: approval.id })"
            >
              Approve
            </button>
            <button
              type="button"
              :disabled="deciding"
              @click="reject.mutate({ approvalId: approval.id })"
            >
              Decline
            </button>
          </li>
        </ul>
      </section>
      <h2>Connected hosts</h2>
      <p v-if="!connections?.length">No MCP host is connected to your account.</p>
      <ul v-else aria-label="Connected MCP hosts">
        <li v-for="connection in connections" :key="connection.clientId">
          {{ connection.clientName ?? connection.clientId }}: {{ connection.scopes.join(', ') }}
          <button
            type="button"
            :disabled="revoking"
            @click="revoke({ clientId: connection.clientId })"
          >
            Disconnect
          </button>
        </li>
      </ul>
      <button type="button" @click="client.signOut()">Sign out</button>
    </template>
    <p v-else>Connect ChatGPT, Claude, or MCP Inspector to sign in.</p>
  </main>
</template>
