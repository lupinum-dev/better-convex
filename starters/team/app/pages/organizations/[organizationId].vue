<script setup lang="ts">
import { api } from '#convex/api'

const route = useRoute()
const organizationId = computed(() => route.params.organizationId as string)
const { status, error: authError } = useConvexAuth()
const organizationsArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))
const { data: organizations, pending: organizationsPending } = await useConvexQuery(
  api.organizations.listMine,
  organizationsArgs,
)
const organization = computed(
  () => organizations.value?.find((org) => org.id === organizationId.value) ?? null,
)
</script>

<template>
  <main class="shell">
    <NuxtLink class="back-link" to="/">Organizations</NuxtLink>
    <section class="header">
      <p>{{ organization?.name ?? 'Organization' }}</p>
      <h1>Projects</h1>
    </section>

    <section v-if="status === 'loading'" class="empty">Checking session...</section>

    <section v-else-if="status === 'error'" class="empty">
      {{ authError?.message ?? 'Authentication failed.' }}
    </section>

    <AuthPanel
      v-else-if="status === 'anonymous'"
      message="Create an account or sign in to manage projects."
    />

    <section v-else-if="organizationsPending" class="empty">Loading organization...</section>

    <section v-else-if="!organization" class="empty">Organization not found.</section>

    <OrganizationDetailWorkspace v-else :organization="organization" />
  </main>
</template>
