<script setup lang="ts">
import { computed } from 'vue'

import type { QueryRegistryEntry } from '../../types'
import JsonViewer from './JsonViewer.vue'

const props = defineProps<{
  query: QueryRegistryEntry | undefined
}>()

const statusClass = computed(() => {
  if (!props.query) return ''
  if (props.query.status === 'success') return 'success'
  if (props.query.status === 'error') return 'error'
  return 'pending'
})

const lastUpdatedTime = computed(() => {
  if (!props.query) return ''
  return new Date(props.query.lastUpdated).toLocaleTimeString()
})

const options = computed<{
  immediate?: boolean
  server?: boolean
  subscribe?: boolean
  auth?: 'required' | 'optional' | 'none'
}>(() => props.query?.options || {})
</script>

<template>
  <div class="detail-panel">
    <div v-if="!query" class="empty-state">
      <div>Select a query to view details</div>
    </div>
    <template v-else>
      <div class="detail-section">
        <div class="detail-title">Query Info</div>
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value" style="color: var(--accent)">{{ query.name }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="badge" :class="statusClass">{{ query.status }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Last Updated</span>
          <span class="detail-value">{{ lastUpdatedTime }}</span>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-title">Options</div>
        <div class="options-grid">
          <div class="option-item">
            <span class="option-icon" :class="options.immediate ? 'enabled' : 'disabled'">
              <svg
                v-if="options.immediate"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg
                v-else
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
            <span>immediate</span>
          </div>
          <div class="option-item">
            <span class="option-icon" :class="options.server ? 'enabled' : 'disabled'">
              <svg
                v-if="options.server"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg
                v-else
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
            <span>server</span>
          </div>
          <div class="option-item">
            <span class="option-icon" :class="options.subscribe ? 'enabled' : 'disabled'">
              <svg
                v-if="options.subscribe"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg
                v-else
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
            <span>subscribe</span>
          </div>
          <div class="option-item">
            <span class="detail-value">auth: {{ options.auth || 'optional' }}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-title">Cache Key</div>
        <div class="json-viewer" style="max-height: 60px">{{ query.id }}</div>
      </div>

      <div class="detail-section">
        <div class="detail-title">Arguments</div>
        <JsonViewer :data="query.args" />
      </div>

      <div class="detail-section">
        <div class="detail-title">Result</div>
        <JsonViewer v-if="!query.error" :data="query.data" />
        <div v-else class="json-viewer">
          <span class="json-string">{{ query.error }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
