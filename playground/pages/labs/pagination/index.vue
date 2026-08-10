<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'

import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Pagination Lab Hub
 *
 * Combines:
 * - Navigation to server + API-mode combinations
 * - Basic paginated query test (from /test-paginated-query)
 */

const { data, status, isLoading, canLoadMore, loadMore, error } = await useConvexPaginatedQuery(
  api.notes.listPaginated,
  {},
  { initialNumItems: 3, auth: 'none' },
)
const notes = computed(() => data.value ?? [])

const addNote = useConvexMutation(api.notes.add)
const removeNote = useConvexMutation(api.notes.remove)
const { pending: addPending } = addNote
const { pending: removePending } = removeNote

// Track add/remove counts for verification
const addCount = ref(0)
const removeCount = ref(0)
const loadMoreCount = ref(0)

async function handleAdd() {
  const timestamp = Date.now()
  await addNote({
    title: `Paginated Test Note ${timestamp}`,
    content: `Created at ${new Date(timestamp).toISOString()} via E2E test`,
  })
  addCount.value++
}

async function handleRemove(id: Id<'notes'>) {
  await removeNote({ id })
  removeCount.value++
}

function handleLoadMore() {
  loadMore(3)
  loadMoreCount.value++
}
</script>

<template>
  <div data-testid="paginated-query-page" class="pagination-hub">
    <h1>Pagination Lab</h1>
    <p>Test paginated query with Load More functionality.</p>

    <h2>Server Mode Combinations</h2>
    <nav class="nav-links">
      <NuxtLink
        to="/labs/pagination/server-false-blocking"
        data-testid="link-server-false-blocking"
        class="nav-link"
      >
        server: false + await useConvexPaginatedQuery
        <span class="hint">No SSR, client nav blocked</span>
      </NuxtLink>

      <NuxtLink
        to="/labs/pagination/server-true-blocking"
        data-testid="link-server-true-blocking"
        class="nav-link best"
      >
        server: true + await useConvexPaginatedQuery
        <span class="hint">SSR + hydration-ready client navigation</span>
      </NuxtLink>
    </nav>

    <h2>Feature Tests</h2>
    <nav class="nav-links small">
      <NuxtLink to="/labs/pagination/features/refresh" class="nav-link">refresh()</NuxtLink>
    </nav>

    <section class="control-section">
      <button
        data-testid="add-btn"
        class="action-btn add-btn"
        :disabled="addPending"
        @click="handleAdd"
      >
        {{ addPending ? 'Adding...' : 'Add Note' }}
      </button>

      <button
        data-testid="load-more-btn"
        class="action-btn load-more-btn"
        :disabled="!canLoadMore"
        @click="handleLoadMore"
      >
        {{ isLoading ? 'Loading...' : 'Load More' }}
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
          <span class="label">isLoading:</span>
          <span data-testid="is-loading" class="value">{{ isLoading }}</span>
        </div>
        <div class="state-item">
          <span class="label">result count:</span>
          <span data-testid="count" class="value">{{ notes.length }}</span>
        </div>
        <div class="state-item">
          <span class="label">adds performed:</span>
          <span data-testid="add-count" class="value">{{ addCount }}</span>
        </div>
        <div class="state-item">
          <span class="label">removes performed:</span>
          <span data-testid="remove-count" class="value">{{ removeCount }}</span>
        </div>
        <div class="state-item">
          <span class="label">load more clicked:</span>
          <span data-testid="load-more-count" class="value">{{ loadMoreCount }}</span>
        </div>
        <div v-if="error" class="state-item error">
          <span class="label">error:</span>
          <span data-testid="error" class="value error-text">{{ error.message }}</span>
        </div>
      </div>
    </section>

    <section class="notes-section">
      <h2>Notes</h2>

      <div v-if="isLoading && notes.length === 0" class="loading" data-testid="loading">
        Loading first page...
      </div>

      <div v-else-if="notes.length === 0" class="empty" data-testid="empty">
        No notes yet. Click "Add Note" to create one.
      </div>

      <ul v-else class="notes-list">
        <li
          v-for="note in notes"
          :key="note._id"
          class="note-item"
          :data-testid="`note-${note._id}`"
        >
          <div class="note-content">
            <strong class="note-title" :data-testid="`note-title-${note._id}`">
              {{ note.title }}
            </strong>
            <p class="note-body">
              {{ note.content }}
            </p>
          </div>
          <button
            class="delete-btn"
            :data-testid="`delete-${note._id}`"
            :disabled="removePending"
            @click="handleRemove(note._id)"
          >
            Delete
          </button>
        </li>
      </ul>

      <div v-if="isLoading && notes.length > 0" class="loading-more" data-testid="loading-more">
        Loading more...
      </div>

      <div
        v-if="status === 'success' && !canLoadMore && notes.length > 0"
        class="exhausted"
        data-testid="exhausted"
      >
        All notes loaded.
      </div>
    </section>

    <div class="info">
      <h2>Expected Behaviors</h2>
      <table>
        <thead>
          <tr>
            <th>server</th>
            <th>API mode</th>
            <th>SSR HTML</th>
            <th>Client Nav</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>false</td>
            <td><code>useConvexPaginatedQuery</code></td>
            <td>status=pending</td>
            <td>instant, loading state</td>
          </tr>
          <tr>
            <td>false</td>
            <td><code>await useConvexPaginatedQuery</code></td>
            <td>status=pending</td>
            <td>blocked until data</td>
          </tr>
          <tr class="highlight">
            <td>true</td>
            <td><code>useConvexPaginatedQuery</code></td>
            <td>hasData=true</td>
            <td>instant, loading state</td>
          </tr>
          <tr>
            <td>true</td>
            <td><code>await useConvexPaginatedQuery</code></td>
            <td>hasData=true</td>
            <td>blocked until data</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.pagination-hub {
  max-width: 700px;
  margin: 0 auto;
}

.pagination-hub h2 {
  margin-top: 30px;
  margin-bottom: 10px;
  font-size: 1.1rem;
  color: #374151;
}

.nav-links {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 10px 0 20px;
}

.nav-links.small {
  flex-direction: row;
  flex-wrap: wrap;
}

.nav-link {
  padding: 12px 16px;
  background: #f0f0f0;
  border-radius: 8px;
  text-decoration: none;
  color: #333;
  transition: background 0.2s;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-links.small .nav-link {
  padding: 8px 16px;
}

.nav-link:hover {
  background: #e0e0e0;
}

.nav-link.best {
  background: #e8f5e9;
  border: 2px solid #4caf50;
}

.nav-link.best:hover {
  background: #c8e6c9;
}

.nav-link .hint {
  font-size: 0.8rem;
  color: #666;
}

.control-section {
  display: flex;
  gap: 10px;
  margin: 20px 0;
}

.action-btn {
  padding: 10px 20px;
  font-size: 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.add-btn {
  background: #4caf50;
  color: white;
}

.add-btn:hover:not(:disabled) {
  background: #45a049;
}

.load-more-btn {
  background: #2196f3;
  color: white;
}

.load-more-btn:hover:not(:disabled) {
  background: #1976d2;
}

.action-btn:disabled {
  background: #9e9e9e;
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
  min-width: 140px;
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

.notes-section {
  margin-top: 20px;
}

.notes-section h2 {
  margin-bottom: 15px;
}

.loading,
.empty,
.loading-more,
.exhausted {
  padding: 20px;
  text-align: center;
  color: #666;
  background: #f8f8f8;
  border-radius: 8px;
}

.exhausted {
  background: #e8f5e9;
  color: #2e7d32;
}

.loading-more {
  margin-top: 10px;
  background: #e3f2fd;
  color: #1565c0;
}

.notes-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.note-item {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  padding: 15px;
  margin: 10px 0;
  background: #f8f8f8;
  border-radius: 8px;
}

.note-content {
  flex: 1;
}

.note-title {
  display: block;
  margin-bottom: 5px;
}

.note-body {
  margin: 0;
  font-size: 14px;
  color: #666;
}

.delete-btn {
  padding: 5px 10px;
  font-size: 14px;
  background: #f44336;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.delete-btn:hover:not(:disabled) {
  background: #d32f2f;
}

.delete-btn:disabled {
  background: #9e9e9e;
  cursor: not-allowed;
}

.info {
  margin-top: 30px;
  padding: 15px;
  background: #f8f8f8;
  border-radius: 8px;
}

.info table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.info th,
.info td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid #ddd;
}

.info th {
  background: #eee;
  font-weight: 600;
}

.info tr.highlight {
  background: #e8f5e9;
}
</style>
