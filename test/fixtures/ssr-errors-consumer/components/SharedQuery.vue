<script setup lang="ts">
import { makeFunctionReference } from 'convex/server'

const query = makeFunctionReference<'query'>('fixture:query')
const result = await useConvexQuery(query, { shared: true })
</script>

<template>
  <p class="shared-query">{{ result.error.value?.message }}</p>
</template>
