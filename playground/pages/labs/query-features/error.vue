<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Test page for error handling
 *
 * Uses testing.alwaysFails query that intentionally throws an error.
 * Expected behavior:
 * - status = 'error'
 * - error contains error message
 * - data = undefined
 * - refresh() retries the query (still fails)
 */

const { data, pending, status, error, refresh } = await useConvexQuery(api.testing.alwaysFails, {})

// Track retry count
const retryCount = ref(0)

async function handleRetry() {
  retryCount.value++
  await refresh()
}
</script>

<template>
  <div data-testid="error-page" class="test-page">
    <h1>Error Query</h1>
    <p class="description">Tests error handling with a query that always fails.</p>

    <NuxtLink to="/labs/query" class="back-link">Back to Query Lab</NuxtLink>

    <section class="state-section">
      <h2>Query State</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="status" class="value" :class="{ error: status === 'error' }">
            {{ status }}
          </span>
        </div>
        <div class="state-item">
          <span class="label">pending:</span>
          <span data-testid="pending" class="value">{{ pending }}</span>
        </div>
        <div class="state-item">
          <span class="label">has error:</span>
          <span data-testid="has-error" class="value">{{ error !== undefined }}</span>
        </div>
        <div class="state-item">
          <span class="label">has data:</span>
          <span data-testid="has-data" class="value">{{ data !== undefined }}</span>
        </div>
        <div class="state-item">
          <span class="label">retry count:</span>
          <span data-testid="retry-count" class="value">{{ retryCount }}</span>
        </div>
      </div>
    </section>

    <section v-if="error" class="error-section">
      <h2>Error Details</h2>
      <div class="error-box">
        <span class="error-label">Message:</span>
        <span data-testid="error-message" class="error-message">
          {{ error.message }}
        </span>
      </div>
    </section>

    <section class="action-section">
      <button data-testid="retry-btn" class="action-btn" :disabled="pending" @click="handleRetry">
        {{ pending ? 'Retrying...' : 'Retry Query' }}
      </button>
    </section>

    <section class="info-section">
      <h2>Expected Values</h2>
      <ul>
        <li>status: <code>error</code></li>
        <li>pending: <code>false</code></li>
        <li>has error: <code>true</code></li>
        <li>has data: <code>false</code></li>
        <li>error message: Contains "Intentional test error"</li>
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
  align-items: center;
}

.label {
  font-weight: 500;
  min-width: 100px;
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

.value.error {
  background: #fee2e2;
  color: #991b1b;
  border-color: #fecaca;
}

.error-section {
  margin: 20px 0;
  padding: 15px;
  background: #fee2e2;
  border-radius: 8px;
  border: 1px solid #fecaca;
}

.error-section h2 {
  margin: 0 0 10px;
  font-size: 1rem;
  color: #991b1b;
}

.error-box {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.error-label {
  font-weight: 500;
  color: #991b1b;
}

.error-message {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  color: #dc2626;
  word-break: break-word;
}

.action-section {
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

.info-section code {
  background: #fff;
  padding: 2px 4px;
  border-radius: 3px;
}
</style>
