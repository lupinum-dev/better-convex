<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Test page for refresh() method
 *
 * Tests that refresh() re-fetches all currently loaded pages via HTTP.
 */

const { data, status, isLoading, canLoadMore, loadMore, refresh, error } =
  await useConvexPaginatedQuery(api.notes.listPaginated, {}, { initialNumItems: 3, auth: 'none' })
const items = computed(() => data.value ?? [])

const refreshCount = ref(0)
const isRefreshing = ref(false)

async function handleRefresh() {
  isRefreshing.value = true
  await refresh()
  refreshCount.value++
  isRefreshing.value = false
}
</script>

<template>
  <div data-testid="paginated-refresh-page" class="test-page">
    <h1>Paginated Query: refresh()</h1>
    <p class="description">Test that refresh() re-fetches all loaded pages.</p>

    <NuxtLink to="/labs/pagination" class="back-link">Back to Pagination Lab</NuxtLink>

    <section class="state-section">
      <h2>Query State</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="status" class="value">{{ status }}</span>
        </div>
        <div class="state-item">
          <span class="label">isLoading:</span>
          <span data-testid="is-loading" class="value">{{ isLoading }}</span>
        </div>
        <div class="state-item">
          <span class="label">result count:</span>
          <span data-testid="count" class="value">{{ items.length }}</span>
        </div>
        <div class="state-item">
          <span class="label">refresh count:</span>
          <span data-testid="refresh-count" class="value">{{ refreshCount }}</span>
        </div>
        <div v-if="error" class="state-item error">
          <span class="label">error:</span>
          <span data-testid="error" class="value error-text">{{ error.message }}</span>
        </div>
      </div>
    </section>

    <section class="actions-section">
      <button
        data-testid="refresh-btn"
        class="action-btn refresh-btn"
        :disabled="isRefreshing"
        @click="handleRefresh"
      >
        {{ isRefreshing ? 'Refreshing...' : 'Refresh' }}
      </button>
      <button
        data-testid="load-more-btn"
        class="action-btn load-more-btn"
        :disabled="!canLoadMore"
        @click="loadMore(3)"
      >
        Load More
      </button>
    </section>

    <section v-if="items.length > 0" class="data-section">
      <h2>Results ({{ items.length }} items)</h2>
      <ul class="results-list">
        <li v-for="item in items" :key="item._id">
          {{ item.title }}
        </li>
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
}

.state-item.error {
  color: #d32f2f;
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

.error-text {
  background: #ffebee;
}

.actions-section {
  display: flex;
  gap: 10px;
  margin: 20px 0;
}

.action-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: white;
  font-weight: 500;
}

.refresh-btn {
  background: #4caf50;
}

.refresh-btn:hover:not(:disabled) {
  background: #45a049;
}

.load-more-btn {
  background: #2196f3;
}

.load-more-btn:hover:not(:disabled) {
  background: #1976d2;
}

.action-btn:disabled {
  background: #9e9e9e;
  cursor: not-allowed;
}

.data-section {
  margin-top: 20px;
}

.data-section h2 {
  margin: 0 0 10px;
  font-size: 1.1rem;
  color: #374151;
}

.results-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.results-list li {
  padding: 10px;
  background: #f8f8f8;
  margin: 5px 0;
  border-radius: 4px;
}
</style>
