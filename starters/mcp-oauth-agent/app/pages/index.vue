<script setup lang="ts">
import { api } from '#convex/api'

const { status, error: authError, client } = useConvexAuth()
const connectionArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))
const { data: connections } = await useConvexQuery(api.connections.list, connectionArgs, {
  auth: 'required',
  server: false,
})
const { mutate: revoke, pending: revoking } = useConvexMutation(api.connections.revoke)
</script>

<template>
  <main>
    <h1>MCP connections</h1>
    <p v-if="status === 'loading'">Checking session…</p>
    <p v-else-if="status === 'error'">
      {{ authError?.message ?? 'Authentication failed.' }}
    </p>
    <template v-else-if="status === 'authenticated'">
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
