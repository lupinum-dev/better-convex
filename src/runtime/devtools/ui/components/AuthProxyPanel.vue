<script setup lang="ts">
import { computed } from 'vue'

import type { AuthProxyStats, AuthProxyRequest } from '../../types'

const props = defineProps<{
  stats: AuthProxyStats | null
  loading?: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getStatusClass(req: AuthProxyRequest): string {
  if (!req.success) return 'error'
  if (req.status && req.status >= 200 && req.status < 300) return 'success'
  if (req.status && req.status >= 300 && req.status < 400) return 'pending'
  // If success is true but status is missing/unknown, treat as success
  return req.success ? 'success' : 'error'
}

const hasRequests = computed(() => props.stats && props.stats.totalRequests > 0)
</script>

<template>
  <div class="auth-card proxy-panel">
    <div class="proxy-header">
      <div class="detail-title">Auth Proxy (SSR)</div>
      <button class="btn btn-secondary btn-small" @click="emit('refresh')">Refresh</button>
    </div>

    <div v-if="loading" class="loading">
      <div class="spinner" />
      <span>Loading...</span>
    </div>

    <div v-else-if="!hasRequests" class="empty-state">
      <div class="empty-state-icon">P</div>
      <div>No proxy requests yet</div>
      <div style="font-size: 11px; margin-top: 4px">
        Auth proxy requests will appear here during SSR
      </div>
    </div>

    <template v-else>
      <!-- Stats summary -->
      <div class="proxy-stats">
        <div class="proxy-stat">
          <div class="proxy-stat-value">{{ stats!.totalRequests }}</div>
          <div class="proxy-stat-label">Requests</div>
        </div>
        <div class="proxy-stat">
          <div class="proxy-stat-value success-text">{{ stats!.successCount }}</div>
          <div class="proxy-stat-label">Success</div>
        </div>
        <div class="proxy-stat">
          <div class="proxy-stat-value error-text">{{ stats!.errorCount }}</div>
          <div class="proxy-stat-label">Errors</div>
        </div>
        <div class="proxy-stat">
          <div class="proxy-stat-value">{{ stats!.avgDuration }}ms</div>
          <div class="proxy-stat-label">Avg Time</div>
        </div>
      </div>

      <!-- Recent requests -->
      <div class="request-list">
        <div v-for="req in stats!.recentRequests" :key="req.id" class="request-row">
          <span class="request-method" :class="req.method.toLowerCase()">{{ req.method }}</span>
          <span class="request-path">{{ req.path }}</span>
          <span class="request-status">
            <span class="badge" :class="getStatusClass(req)">
              {{ req.status || 'ERR' }}
            </span>
          </span>
          <span class="request-duration">{{ req.duration }}ms</span>
          <span class="request-time">{{ formatTime(req.timestamp) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.proxy-panel {
  margin-top: 0;
}

.proxy-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.proxy-header .detail-title {
  margin-bottom: 0;
}

.proxy-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--border);
}

.proxy-stat {
  text-align: center;
  flex: 1;
}

.proxy-stat-value {
  font-size: 18px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}

.proxy-stat-value.success-text {
  color: var(--success);
}

.proxy-stat-value.error-text {
  color: var(--error);
}

.proxy-stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.request-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.request-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}

.request-row:last-child {
  border-bottom: none;
}

.request-row:hover {
  background: var(--bg-hover);
}

.request-method {
  font-weight: 600;
  min-width: 50px;
  color: var(--accent);
}

.request-method.get {
  color: var(--success);
}

.request-method.post {
  color: var(--info);
}

.request-method.delete {
  color: var(--error);
}

.request-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.request-status {
  min-width: 50px;
}

.request-duration {
  color: var(--text-secondary);
  min-width: 50px;
  text-align: right;
}

.request-time {
  color: var(--text-secondary);
  min-width: 70px;
  text-align: right;
  font-size: 11px;
}
</style>
