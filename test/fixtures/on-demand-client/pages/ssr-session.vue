<script setup lang="ts">
// Default SSR auth: the server resolves the session from the cookie.
const { status } = useConvexAuth()
</script>

<template>
  <p data-testid="status">{{ status }}</p>
</template>
