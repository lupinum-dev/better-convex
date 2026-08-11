<script setup lang="ts">
import { ref } from 'vue'

const visible = ref(true)
</script>

<template>
  <main data-consumer="better-convex-nuxt-lifecycle">
    <LifecycleProbe v-if="visible" :dispose="() => (visible = false)" />
    <p v-else data-disposed>disposed</p>
  </main>
</template>
