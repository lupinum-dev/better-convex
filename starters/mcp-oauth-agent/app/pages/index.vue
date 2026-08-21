<script setup lang="ts">
import { api } from '#convex/api'

const { status, pending, error: authError, client } = useConvexAuth()
const currentUserArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))
const { data: currentUser } = await useConvexQuery(api.users.getCurrent, currentUserArgs, {
  auth: 'required',
  server: false,
})

async function handleSignOut() {
  if (!client) throw new Error('Authentication client unavailable')
  await client.signOut()
}
</script>

<template>
  <main>
    <h1>Delegated MCP fixture</h1>
    <p v-if="status === 'loading'">Checking session…</p>
    <p v-else-if="status === 'error'">
      {{ authError?.message ?? 'Authentication failed.' }}
    </p>
    <template v-else-if="status === 'authenticated'">
      <p v-if="currentUser?.email" data-testid="signed-in-user">
        Signed in as {{ currentUser.email }}
      </p>
      <p v-else data-testid="signed-in-user">Finishing account setup…</p>
      <button type="button" :disabled="pending" @click="handleSignOut">
        {{ pending ? 'Signing out…' : 'Sign out' }}
      </button>
    </template>
    <NuxtLink v-else-if="status === 'anonymous'" to="/login">Sign in</NuxtLink>
  </main>
</template>
