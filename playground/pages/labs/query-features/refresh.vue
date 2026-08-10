<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Test page for refresh() method
 *
 * Tests manual data refresh behavior.
 * Expected behavior:
 * - Clicking refresh() should refetch data
 * - pending should briefly become true during refresh
 * - Data should update (if changed on server)
 */

const { data, pending, status, refresh } = await useConvexQuery(api.notes.list, {})

// Track refresh count and timestamps
const refreshCount = ref(0)
const lastRefreshTime = ref<number | null>(null)

async function handleRefresh() {
  refreshCount.value++
  lastRefreshTime.value = Date.now()
  await refresh()
}

// Capture initial data timestamp for comparison
const initialDataLength = ref<number | null>(null)
watch(
  data,
  (newData) => {
    if (newData && initialDataLength.value === null) {
      initialDataLength.value = newData.length
    }
  },
  { immediate: true },
)
</script>

<template>
  <div data-testid="refresh-page" class="test-page">
    <h1>refresh() Method</h1>
    <p class="description">Tests manual data refresh behavior.</p>

    <NuxtLink to="/labs/query" class="back-link">Back to Query Lab</NuxtLink>

    <section class="control-section">
      <button
        data-testid="refresh-btn"
        class="action-btn"
        :disabled="pending"
        @click="handleRefresh"
      >
        {{ pending ? 'Refreshing...' : 'Refresh Data' }}
      </button>
    </section>

    <section class="state-section">
      <h2>Query State</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="status" class="value">{{ status }}</span>
        </div>
        <div class="state-item">
          <span class="label">pending:</span>
          <span data-testid="pending" class="value">{{ pending }}</span>
        </div>
        <div class="state-item">
          <span class="label">data count:</span>
          <span data-testid="data-count" class="value">{{ data?.length ?? 0 }}</span>
        </div>
        <div class="state-item">
          <span class="label">initial count:</span>
          <span data-testid="initial-count" class="value">{{ initialDataLength ?? 'N/A' }}</span>
        </div>
        <div class="state-item">
          <span class="label">refresh count:</span>
          <span data-testid="refresh-count" class="value">{{ refreshCount }}</span>
        </div>
        <div class="state-item">
          <span class="label">last refresh:</span>
          <span data-testid="last-refresh" class="value">
            {{ lastRefreshTime ? new Date(lastRefreshTime).toLocaleTimeString() : 'Never' }}
          </span>
        </div>
      </div>
    </section>

    <section class="info-section">
      <h2>What to Test</h2>
      <ul>
        <li>Click refresh - pending should briefly be true</li>
        <li>Console should show refresh/refetch logs</li>
        <li>Data count updates if server data changed</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.test-page {
  max-width: 600px;
  margin: 0 auto;
}

.description {
  color: #6b7280;
  margin-bottom: 20px;
}

.back-link {
  display: inline-block;
  margin-bottom: 20px;
  color: #3b82f6;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.control-section {
  margin: 20px 0;
}

.action-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: #2563eb;
}

.action-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.state-section {
  margin: 20px 0;
  padding: 15px;
  background: #f8f8f8;
  border-radius: 8px;
}

.state-section h2 {
  margin: 0 0 15px;
  font-size: 1.1rem;
  color: #374151;
}

.state-grid {
  display: grid;
  gap: 8px;
}

.state-item {
  display: flex;
  gap: 10px;
  align-items: center;
}

.label {
  font-weight: 500;
  min-width: 120px;
  color: #6b7280;
}

.value {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  background: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.9rem;
  border: 1px solid #e5e7eb;
}

.info-section {
  margin-top: 20px;
  padding: 15px;
  background: #eff6ff;
  border-radius: 8px;
  border: 1px solid #bfdbfe;
}

.info-section h2 {
  margin: 0 0 10px;
  font-size: 1rem;
  color: #1e40af;
}

.info-section ul {
  margin: 0;
  padding-left: 20px;
  color: #1e40af;
}
</style>
