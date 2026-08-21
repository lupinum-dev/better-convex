<script setup lang="ts">
import { computed } from 'vue'

import type { AuthProxyStats } from '../../types'
import { agentDiagnosticOutcome } from '../agent-diagnostics'

const props = defineProps<{
  stats: AuthProxyStats | null
  loading?: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const decisions = computed(() =>
  (props.stats?.recentRequests ?? []).filter((request) =>
    /oauth|\.well-known|\/mcp(?:\/|$)/u.test(request.path),
  ),
)
</script>

<template>
  <div class="auth-card">
    <div class="proxy-header">
      <div>
        <div class="detail-title">Agent OAuth</div>
        <div class="detail-value">Sanitized Nuxt proxy decisions only</div>
      </div>
      <button class="btn btn-secondary btn-small" @click="emit('refresh')">Refresh</button>
    </div>

    <div v-if="loading" class="loading">
      <div class="spinner" />
      Loading diagnostics…
    </div>
    <div v-else-if="decisions.length === 0" class="empty-state">
      <div>No observable agent OAuth proxy events yet</div>
      <div style="font-size: 11px; margin-top: 4px">
        Tokens, cookies, authorization codes, PKCE verifiers, keys, and raw causes are never shown.
      </div>
    </div>
    <div v-else class="request-list">
      <div v-for="request in decisions" :key="request.id" class="request-row">
        <span class="request-method">{{ request.method }}</span>
        <span class="request-path">{{ request.path }}</span>
        <span class="badge" :class="agentDiagnosticOutcome(request).badge">
          {{ agentDiagnosticOutcome(request).label }}
        </span>
        <span class="request-duration">{{ request.duration }}ms</span>
      </div>
    </div>
    <div class="scope-note">
      Convex-side MCP failures are intentionally available only through the request-scoped
      <code>onToolError</code> hook and application logs.
    </div>
  </div>
</template>

<style scoped>
.proxy-header,
.request-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.proxy-header {
  justify-content: space-between;
  margin-bottom: 12px;
}
.request-list {
  border: 1px solid var(--border);
  border-radius: 6px;
}
.request-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font:
    12px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.request-row:last-child {
  border-bottom: 0;
}
.request-method {
  color: var(--accent);
  min-width: 48px;
}
.request-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.request-duration {
  color: var(--text-secondary);
}
.scope-note {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
  margin-top: 12px;
}
</style>
