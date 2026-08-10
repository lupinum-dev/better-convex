<script setup lang="ts">
import { formatAuditTimestamp } from '~/utils/formatTime'

type AuditEvent = {
  _id: string
  action: string
  summary?: string
  createdAt: number
}

defineProps<{
  title: string
  events: readonly AuditEvent[]
  canLoadMore: boolean
  onLoadMore: (numItems: number) => void
}>()
</script>

<template>
  <section class="activity">
    <h2>{{ title }}</h2>
    <ul v-if="events.length" class="items-list">
      <li v-for="event in events" :key="event._id">
        <span>{{ event.summary ?? event.action }}</span>
        <time :datetime="new Date(event.createdAt).toISOString()">
          {{ formatAuditTimestamp(event.createdAt) }}
        </time>
      </li>
    </ul>
    <section v-else class="empty">No {{ title.toLowerCase() }} yet.</section>
    <button v-if="canLoadMore" class="button" @click="onLoadMore(10)">Load more</button>
  </section>
</template>
