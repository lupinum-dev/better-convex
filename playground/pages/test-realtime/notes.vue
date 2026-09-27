<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '~/convex/_generated/dataModel'

/**
 * Test page for real-time subscription updates
 *
 * Uses notes.list query and notes.add/remove mutations.
 * Expected behavior:
 * - Adding a note should immediately update the list
 * - Deleting a note should immediately update the list
 * - No page refresh needed - subscription handles updates
 */

const { data, pending, status, error } = await useConvexQuery(api.notes.list, {})

const { mutate: addNote, pending: addPending } = useConvexMutation(api.notes.add)
const { mutate: removeNote, pending: removePending } = useConvexMutation(api.notes.remove)

// Track add/remove counts for verification
const addCount = ref(0)
const removeCount = ref(0)

async function handleAdd() {
  const timestamp = Date.now()
  await addNote({
    title: `E2E Test Note ${timestamp}`,
    content: `Created at ${new Date(timestamp).toISOString()} via E2E test`,
  })
  addCount.value++
}

async function handleRemove(id: Id<'notes'>) {
  await removeNote({ id })
  removeCount.value++
}
</script>

<template>
  <div data-testid="realtime-page" class="test-page">
    <h1>Real-time Updates: Notes</h1>
    <p>Add and delete notes to test real-time subscription updates.</p>

    <NuxtLink to="/test-realtime/hub" class="back-link">Back to Hub</NuxtLink>

    <section class="control-section">
      <button
        data-testid="add-btn"
        class="action-btn add-btn"
        :disabled="addPending"
        @click="handleAdd"
      >
        {{ addPending ? 'Adding...' : 'Add Note' }}
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
        <div v-if="error" class="state-item">
          <span class="label">error:</span>
          <span data-testid="error" class="value" style="color: red">{{ error.message }}</span>
        </div>
        <div class="state-item">
          <span class="label">note count:</span>
          <span data-testid="count" class="value">{{ data?.length ?? 0 }}</span>
        </div>
        <div class="state-item">
          <span class="label">adds performed:</span>
          <span data-testid="add-count" class="value">{{ addCount }}</span>
        </div>
        <div class="state-item">
          <span class="label">removes performed:</span>
          <span data-testid="remove-count" class="value">{{ removeCount }}</span>
        </div>
      </div>
    </section>

    <section class="notes-section">
      <h2>Notes</h2>

      <div v-if="pending && !data" class="loading" data-testid="loading">Loading notes...</div>

      <div v-else-if="data && data.length === 0" class="empty" data-testid="empty">
        No notes yet. Click "Add Note" to create one.
      </div>

      <ul v-else-if="data" class="notes-list">
        <li
          v-for="note in data"
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
    </section>
  </div>
</template>

<style scoped>
.test-page {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.back-link {
  display: inline-block;
  margin-bottom: 20px;
  color: #0066cc;
}

.control-section {
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

.add-btn:disabled {
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

.label {
  font-weight: 500;
  min-width: 130px;
}

.value {
  font-family: monospace;
  background: #fff;
  padding: 2px 6px;
  border-radius: 4px;
}

.notes-section {
  margin-top: 20px;
}

.notes-section h2 {
  margin-bottom: 15px;
}

.loading,
.empty {
  padding: 20px;
  text-align: center;
  color: #666;
  background: #f8f8f8;
  border-radius: 8px;
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
</style>
