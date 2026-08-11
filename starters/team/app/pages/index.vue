<script setup lang="ts">
const { status, error } = useConvexAuth()

function retryAuthentication() {
  window.location.reload()
}
</script>

<template>
  <main class="shell">
    <section class="header">
      <p>Team starter</p>
      <h1>Organizations</h1>
    </section>

    <section v-if="status === 'loading'" class="empty">Checking session...</section>

    <section v-else-if="status === 'error'" class="empty">
      <p>{{ error?.message ?? 'Authentication failed.' }}</p>
      <button type="button" @click="retryAuthentication">Reload and retry</button>
    </section>

    <template v-else-if="status === 'anonymous'">
      <AuthPanel message="Create an account or sign in to manage organizations." />
    </template>

    <template v-else-if="status === 'authenticated'">
      <OrganizationWorkspace />
    </template>
  </main>
</template>
