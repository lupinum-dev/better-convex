<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Test page for static skip behavior
 *
 * Uses the explicit skip sentinel to permanently skip the query.
 * Expected behavior:
 * - status = 'idle'
 * - data = undefined
 * - pending = false
 * - No network requests made
 */

const { data, pending, status, error } = await useConvexQuery(api.notes.list, 'skip')
</script>

<template>
  <div data-testid="static-skip-page" class="test-page">
    <h1>Static Skip</h1>
    <p class="description">Query is always skipped with the explicit skip sentinel</p>

    <NuxtLink to="/labs/query" class="back-link">Back to Query Lab</NuxtLink>

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
          <span class="label">data:</span>
          <span data-testid="data" class="value">{{
            data === undefined ? 'undefined' : JSON.stringify(data)
          }}</span>
        </div>
        <div class="state-item">
          <span class="label">has data:</span>
          <span data-testid="has-data" class="value">{{ data !== undefined }}</span>
        </div>
        <div v-if="error" class="state-item">
          <span class="label">error:</span>
          <span data-testid="error" class="value error">{{ error.message }}</span>
        </div>
      </div>
    </section>

    <section class="info-section">
      <h2>Expected Values</h2>
      <ul>
        <li>status: <code>idle</code></li>
        <li>pending: <code>false</code></li>
        <li>data: <code>undefined</code></li>
        <li>has data: <code>false</code></li>
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
