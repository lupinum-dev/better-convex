<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'

import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Optimistic Updates Lab
 *
 * Tests optimistic updates with mutations.
 * Uses notes.list query and notes.add/remove mutations with optimistic updates.
 *
 * Expected behavior:
 * - Adding a note should IMMEDIATELY appear in the list (optimistic)
 * - After server confirms, the optimistic item is replaced with real data
 * - Deleting a note should IMMEDIATELY disappear (optimistic)
 *
 * Console log sequence for ADD:
 * 1. "[Optimistic] Mutate called" - when execute() starts
 * 2. "[Optimistic] Data changed" - when optimistic update applies (IMMEDIATE)
 * 3. "[Optimistic] Mutate completed" - when server responds
 * 4. "Real-time update received" - when subscription confirms
 */

const { data, pending, status } = await useConvexQuery(api.notes.list, {})

// Track add/remove counts for verification
const addCount = ref(0)
const removeCount = ref(0)

// Watch for data changes and log them (for E2E verification)
watch(
  () => data.value?.length,
  (newLength, oldLength) => {
    if (newLength !== oldLength) {
      console.log(`[Optimistic] Data changed: count=${newLength} (was ${oldLength})`)
    }
  },
)

// Mutation WITH optimistic update
const addNoteOptimistic = useConvexMutation(api.notes.add, {
  optimisticUpdate: (localStore, args) => {
    console.log('[Optimistic] Applying optimistic update for add')
    const current = localStore.getQuery(api.notes.list, {})
    const now = Date.now()
    const optimisticNote = {
      _id: `optimistic-${now}` as Id<'notes'>,
      _creationTime: now,
      createdAt: now,
      title: args.title,
      content: args.content,
    }
    console.log('[Optimistic] Created optimistic note:', optimisticNote.title)
    localStore.setQuery(
      api.notes.list,
      {},
      current ? [optimisticNote, ...current] : [optimisticNote],
    )
  },
})
const { pending: addPendingOptimistic } = addNoteOptimistic

// Mutation WITHOUT optimistic update (for comparison)
const addNoteNormal = useConvexMutation(api.notes.add)
const { pending: addPendingNormal } = addNoteNormal

// Delete mutation WITH optimistic update
const removeNoteOptimistic = useConvexMutation(api.notes.remove, {
  optimisticUpdate: (localStore, args) => {
    console.log('[Optimistic] Applying optimistic update for remove')
    const current = localStore.getQuery(api.notes.list, {})
    if (current) {
      localStore.setQuery(
        api.notes.list,
        {},
        current.filter((note) => note._id !== args.id),
      )
    }
  },
})
const { pending: removePendingOptimistic } = removeNoteOptimistic

// Delete mutation WITHOUT optimistic update (for comparison)
const removeNoteNormal = useConvexMutation(api.notes.remove)
const { pending: removePendingNormal } = removeNoteNormal

async function handleAddOptimistic() {
  const timestamp = Date.now()
  console.log('[Optimistic] Mutate called - ADD with optimistic')
  await addNoteOptimistic({
    title: `Optimistic Note ${timestamp}`,
    content: `Created with optimistic update at ${new Date(timestamp).toISOString()}`,
  })
  console.log('[Optimistic] Mutate completed - ADD with optimistic')
  addCount.value++
}

async function handleAddNormal() {
  const timestamp = Date.now()
  console.log('[Normal] Mutate called - ADD without optimistic')
  await addNoteNormal({
    title: `Normal Note ${timestamp}`,
    content: `Created without optimistic update at ${new Date(timestamp).toISOString()}`,
  })
  console.log('[Normal] Mutate completed - ADD without optimistic')
  addCount.value++
}

async function handleRemoveOptimistic(id: string) {
  console.log('[Optimistic] Mutate called - REMOVE with optimistic')
  await removeNoteOptimistic({ id: id as Id<'notes'> })
  console.log('[Optimistic] Mutate completed - REMOVE with optimistic')
  removeCount.value++
}

async function handleRemoveNormal(id: string) {
  console.log('[Normal] Mutate called - REMOVE without optimistic')
  await removeNoteNormal({ id: id as Id<'notes'> })
  console.log('[Normal] Mutate completed - REMOVE without optimistic')
  removeCount.value++
}
</script>

<template>
  <div data-testid="optimistic-page" class="test-page">
    <h1>Optimistic Updates Lab</h1>
    <p class="description">Compare behavior with and without optimistic updates.</p>

    <section class="control-section">
      <div class="button-row">
        <button
          data-testid="add-optimistic-btn"
          class="action-btn add-btn optimistic"
          :disabled="addPendingOptimistic"
          @click="handleAddOptimistic"
        >
          {{ addPendingOptimistic ? 'Adding...' : 'Add (Optimistic)' }}
        </button>

        <button
          data-testid="add-normal-btn"
          class="action-btn add-btn normal"
          :disabled="addPendingNormal"
          @click="handleAddNormal"
        >
          {{ addPendingNormal ? 'Adding...' : 'Add (Normal)' }}
        </button>
      </div>
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
        No notes yet. Click a button to create one.
      </div>

      <ul v-else-if="data" class="notes-list">
        <li
          v-for="note in data"
          :key="note._id"
          class="note-item"
          :class="{ optimistic: note._id.startsWith('optimistic-') }"
          :data-testid="`note-${note._id}`"
        >
          <div class="note-content">
            <strong class="note-title" :data-testid="`note-title-${note._id}`">
              {{ note.title }}
              <span v-if="note._id.startsWith('optimistic-')" class="optimistic-badge">
                (optimistic)
              </span>
            </strong>
            <p class="note-body">
              {{ note.content }}
            </p>
          </div>
          <div class="button-group">
            <button
              class="delete-btn optimistic"
              :data-testid="`delete-optimistic-${note._id}`"
              :disabled="removePendingOptimistic"
              @click="handleRemoveOptimistic(note._id)"
            >
              Delete (Opt)
            </button>
            <button
              class="delete-btn normal"
              :data-testid="`delete-normal-${note._id}`"
              :disabled="removePendingNormal"
              @click="handleRemoveNormal(note._id)"
            >
              Delete (Norm)
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.test-page {
  max-width: 700px;
  margin: 0 auto;
}

.description {
  color: #6b7280;
  margin-bottom: 20px;
}

.control-section {
  margin: 20px 0;
}

.button-row {
  display: flex;
  gap: 10px;
}

.action-btn {
  padding: 10px 20px;
  font-size: 16px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.add-btn.optimistic {
  background: #4caf50;
  color: white;
}

.add-btn.optimistic:hover:not(:disabled) {
  background: #45a049;
}

.add-btn.normal {
  background: #2196f3;
  color: white;
}

.add-btn.normal:hover:not(:disabled) {
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

.label {
  font-weight: 500;
  min-width: 130px;
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

.notes-section {
  margin-top: 20px;
}

.notes-section h2 {
  margin-bottom: 15px;
  font-size: 1.1rem;
  color: #374151;
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
  border: 2px solid transparent;
}

.note-item.optimistic {
  background: #e8f5e9;
  border-color: #4caf50;
}

.note-content {
  flex: 1;
}

.note-title {
  display: block;
  margin-bottom: 5px;
}

.optimistic-badge {
  font-size: 12px;
  color: #4caf50;
  font-weight: normal;
}

.note-body {
  margin: 0;
  font-size: 14px;
  color: #666;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.delete-btn {
  padding: 5px 10px;
  font-size: 12px;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.delete-btn.optimistic {
  background: #f44336;
}

.delete-btn.optimistic:hover:not(:disabled) {
  background: #d32f2f;
}

.delete-btn.normal {
  background: #ff9800;
}

.delete-btn.normal:hover:not(:disabled) {
  background: #f57c00;
}

.delete-btn:disabled {
  background: #9e9e9e;
  cursor: not-allowed;
}
</style>
