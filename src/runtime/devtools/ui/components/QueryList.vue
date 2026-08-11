<script setup lang="ts">
import type { QueryRegistryEntry } from '../../types'

defineProps<{
  queries: QueryRegistryEntry[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

function getStatusClass(status: string): string {
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  return 'pending'
}
</script>

<template>
  <div class="master-list">
    <div v-if="queries.length === 0" class="empty-state">
      <div class="empty-state-icon">Q</div>
      <div>No active queries</div>
    </div>
    <div
      v-for="q in queries"
      v-else
      :key="q.id"
      class="list-item"
      :class="{ selected: selectedId === q.id }"
      @click="emit('select', q.id)"
    >
      <div class="list-item-header">
        <span class="list-item-name">{{ q.name }}</span>
        <span class="badge" :class="getStatusClass(q.status)">{{ q.status }}</span>
      </div>
      <div class="list-item-meta">
        <span>{{ new Date(q.lastUpdated).toLocaleTimeString() }}</span>
      </div>
    </div>
  </div>
</template>
