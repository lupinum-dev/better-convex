<script setup lang="ts">
// Public page: renders without SSR auth and loads no Convex or Better Auth
// client until the button activates the browser runtime.
const { active, activate, connect } = useConvexActivation()
const { status } = useConvexAuth()
</script>

<template>
  <main>
    <p data-testid="connect">{{ connect }}</p>
    <p data-testid="active">{{ active }}</p>
    <p data-testid="status">{{ status }}</p>
    <button type="button" data-testid="activate" @click="activate()">Activate</button>
  </main>
</template>
