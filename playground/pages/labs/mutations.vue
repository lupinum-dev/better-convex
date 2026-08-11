<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

/**
 * Mutations Lab
 *
 * Tests all states of useConvexMutation:
 * - idle: initial state, no mutation running
 * - pending: mutation in progress
 * - success: mutation completed successfully
 * - error: mutation failed
 */

// Successful mutation
const addNote = useConvexMutation(api.notes.add)
const { pending: addPending, status: addStatus, error: addError, data: addData } = addNote

// Error mutation
const failMutation = useConvexMutation(api.testing.alwaysFailsMutation)
const { pending: failPending, status: failStatus, error: failError } = failMutation

// Track mutation counts
const successCount = ref(0)
const errorCount = ref(0)

async function handleSuccess() {
  try {
    await addNote({
      title: `Test Note ${Date.now()}`,
      content: 'Created via mutation status test',
    })
    successCount.value++
  } catch {
    // Error is tracked in error ref
  }
}

async function handleError() {
  try {
    await failMutation({})
  } catch {
    // Expected to fail
    errorCount.value++
  }
}
</script>

<template>
  <div data-testid="mutation-status-page" class="test-page">
    <h1>Mutations Lab</h1>
    <p class="description">Test mutation status tracking and error handling.</p>

    <section class="control-section">
      <button
        data-testid="success-btn"
        class="btn success-btn"
        :disabled="addPending"
        @click="handleSuccess"
      >
        {{ addPending ? 'Running...' : 'Run Success Mutation' }}
      </button>

      <button
        data-testid="error-btn"
        class="btn error-btn"
        :disabled="failPending"
        @click="handleError"
      >
        {{ failPending ? 'Running...' : 'Run Error Mutation' }}
      </button>
    </section>

    <section class="state-section">
      <h2>Success Mutation State</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="add-status" class="value">{{ addStatus }}</span>
        </div>
        <div class="state-item">
          <span class="label">pending:</span>
          <span data-testid="add-pending" class="value">{{ addPending }}</span>
        </div>
        <div class="state-item">
          <span class="label">error:</span>
          <span data-testid="add-error" class="value">{{ addError?.message ?? 'undefined' }}</span>
        </div>
        <div class="state-item">
          <span class="label">data (noteId):</span>
          <span data-testid="add-data" class="value">{{ addData ?? 'undefined' }}</span>
        </div>
        <div class="state-item">
          <span class="label">success count:</span>
          <span data-testid="success-count" class="value">{{ successCount }}</span>
        </div>
      </div>
    </section>

    <section class="state-section error">
      <h2>Error Mutation State</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="fail-status" class="value">{{ failStatus }}</span>
        </div>
        <div class="state-item">
          <span class="label">pending:</span>
          <span data-testid="fail-pending" class="value">{{ failPending }}</span>
        </div>
        <div class="state-item">
          <span class="label">error:</span>
          <span data-testid="fail-error" class="value">{{
            failError?.message ?? 'undefined'
          }}</span>
        </div>
        <div class="state-item">
          <span class="label">error count:</span>
          <span data-testid="error-count" class="value">{{ errorCount }}</span>
        </div>
      </div>
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

.control-section {
  display: flex;
  gap: 10px;
  margin: 20px 0;
  flex-wrap: wrap;
}

.btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.success-btn {
  background: #4caf50;
  color: white;
}
.error-btn {
  background: #f44336;
  color: white;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.state-section {
  margin: 20px 0;
  padding: 15px;
  background: #f8f8f8;
  border-radius: 8px;
}

.state-section.error {
  background: #fff5f5;
}

.state-section h2 {
  margin: 0 0 15px;
  font-size: 1rem;
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
  word-break: break-all;
  font-size: 0.9rem;
  border: 1px solid #e5e7eb;
}
</style>
