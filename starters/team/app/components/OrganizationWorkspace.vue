<script setup lang="ts">
import { api } from '#convex/api'

const { data: currentUser } = await useConvexQuery(
  api.users.getCurrent,
  {},
  {
    auth: 'required',
    server: false,
  },
)
const { client, isPending } = useConvexAuth()
const { data: organizations, pending: organizationsPending } = await useConvexQuery(
  api.organizations.listMine,
  {},
)

const hasUserProjection = computed(() => currentUser.value != null)

async function handleSignOut() {
  if (!client) throw new Error('Authentication client unavailable')
  await client.signOut()
}
</script>

<template>
  <section v-if="currentUser" class="user">
    <span>
      {{ currentUser.email || currentUser.name || 'Signed in' }}
    </span>
    <button type="button" :disabled="isPending" @click="handleSignOut">
      {{ isPending ? 'Signing out...' : 'Sign out' }}
    </button>
  </section>

  <template v-if="hasUserProjection">
    <OrganizationCreateForm />

    <section v-if="organizationsPending" class="empty">Loading organizations...</section>

    <nav v-else-if="organizations?.length" class="list">
      <NuxtLink v-for="org in organizations" :key="org.id" :to="`/organizations/${org.id}`">
        <strong>{{ org.name }}</strong>
        <span>{{ org.role ?? 'member' }}</span>
      </NuxtLink>
    </nav>

    <section v-else class="empty">No organizations yet.</section>
  </template>

  <section v-else class="empty">Finishing account setup...</section>
</template>
