<template>
  <div class="container">
    <h1>Server Actions Lab</h1>
    <p class="description">
      Test the <code>serverConvex</code> caller (<code>.query</code> / <code>.mutation</code>) for
      server-side Convex operations. These work in API routes, server middleware, and background
      jobs.
    </p>

    <div class="sections">
      <!-- serverConvex().query Section -->
      <section class="section">
        <h2>serverConvex().query</h2>
        <p class="section-desc">Fetch data from Convex on the server side.</p>

        <div class="controls">
          <label>
            Limit:
            <input v-model.number="queryLimit" type="number" min="1" max="20" />
          </label>
          <button :disabled="isQueryLoading" @click="testFetchQuery">
            {{ isQueryLoading ? 'Loading...' : 'Test serverConvex().query' }}
          </button>
        </div>

        <div v-if="queryResult" class="result" :class="{ error: !queryResult.success }">
          <div class="result-header">
            <span class="badge" :class="queryResult.success ? 'success' : 'error'">
              {{ queryResult.success ? 'Success' : 'Error' }}
            </span>
            <span class="meta">Executed on: {{ queryResult.executedOn }}</span>
          </div>
          <pre>{{ JSON.stringify(queryResult, null, 2) }}</pre>
        </div>
      </section>

      <!-- serverConvex().mutation Section -->
      <section class="section">
        <h2>serverConvex().mutation</h2>
        <p class="section-desc">Execute mutations on Convex from the server side.</p>

        <div class="controls">
          <input v-model="noteTitle" type="text" placeholder="Note title" />
          <input v-model="noteContent" type="text" placeholder="Note content" />
          <button :disabled="isMutationLoading" @click="testFetchMutation">
            {{ isMutationLoading ? 'Creating...' : 'Test serverConvex().mutation' }}
          </button>
        </div>

        <div v-if="mutationResult" class="result" :class="{ error: !mutationResult.success }">
          <div class="result-header">
            <span class="badge" :class="mutationResult.success ? 'success' : 'error'">
              {{ mutationResult.success ? 'Success' : 'Error' }}
            </span>
            <span class="meta">Executed on: {{ mutationResult.meta?.executedOn }}</span>
          </div>
          <pre>{{ JSON.stringify(mutationResult, null, 2) }}</pre>
        </div>
      </section>

      <!-- Usage Examples -->
      <section class="section">
        <h2>Usage in API Routes</h2>
        <div class="code-example">
          <h3>Server Query (GET /api/test-server-query)</h3>
          <pre><code>import { serverConvex } from '#convex/server'
import { api } from '#convex/api'

export default defineEventHandler(async (event) => {
  const notes = await serverConvex(event).query(api.notes.list)
  return { notes }
})</code></pre>
        </div>

        <div class="code-example">
          <h3>Server Mutation (POST /api/test-server-mutation)</h3>
          <pre><code>import { serverConvex } from '#convex/server'
import { api } from '#convex/api'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const noteId = await serverConvex(event).mutation(
    api.notes.add,
    { title: body.title, content: body.content }
  )
  return { noteId }
})</code></pre>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'sidebar',
})

const queryLimit = ref(5)
const isQueryLoading = ref(false)
type ServerQueryResult = {
  success: boolean
  executedOn?: string
  [key: string]: unknown
}

type ServerMutationResult = {
  success: boolean
  meta?: {
    executedOn?: string
  }
  [key: string]: unknown
}

const queryResult = ref<ServerQueryResult | null>(null)

const noteTitle = ref('')
const noteContent = ref('')
const isMutationLoading = ref(false)
const mutationResult = ref<ServerMutationResult | null>(null)

async function testFetchQuery() {
  isQueryLoading.value = true
  queryResult.value = null

  try {
    const response = await $fetch(`/api/test-server-query?limit=${queryLimit.value}`)
    queryResult.value = response as ServerQueryResult
  } catch (error) {
    queryResult.value = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    isQueryLoading.value = false
  }
}

async function testFetchMutation() {
  isMutationLoading.value = true
  mutationResult.value = null

  try {
    const response = await $fetch('/api/test-server-mutation', {
      method: 'POST',
      body: {
        title: noteTitle.value || undefined,
        content: noteContent.value || undefined,
      },
    })
    mutationResult.value = response as ServerMutationResult
    // Clear inputs on success
    if ((response as Record<string, unknown>).success) {
      noteTitle.value = ''
      noteContent.value = ''
    }
  } catch (error) {
    mutationResult.value = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    isMutationLoading.value = false
  }
}
</script>

<style scoped>
.container {
  max-width: 800px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 8px;
}

.description {
  color: #666;
  margin-bottom: 24px;
}

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.section {
  background: white;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
}

.section-desc {
  color: #666;
  margin: 0 0 16px;
  font-size: 0.9rem;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}

.controls input[type='number'] {
  width: 60px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
}

.controls input[type='text'] {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  min-width: 150px;
}

.controls button {
  padding: 8px 16px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
}

.controls button:hover:not(:disabled) {
  background: #4338ca;
}

.controls button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.result {
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 8px;
  padding: 16px;
}

.result.error {
  background: #fef2f2;
  border-color: #fca5a5;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.badge.success {
  background: #d1fae5;
  color: #065f46;
}

.badge.error {
  background: #fee2e2;
  color: #991b1b;
}

.meta {
  color: #6b7280;
  font-size: 0.85rem;
}

.result pre {
  margin: 0;
  font-size: 0.8rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.code-example {
  background: #1f2937;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.code-example:last-child {
  margin-bottom: 0;
}

.code-example h3 {
  color: #9ca3af;
  font-size: 0.85rem;
  margin: 0 0 12px;
  font-weight: 500;
}

.code-example pre {
  margin: 0;
}

.code-example code {
  background: none;
  padding: 0;
  color: #e5e7eb;
  font-size: 0.8rem;
  line-height: 1.5;
}
</style>
