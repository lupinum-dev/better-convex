<script setup lang="ts">
import { api } from '#convex/api'

interface Props {
  serverOption: boolean
  pageId: string
  title: string
  description: string
  hubLink?: string
}

const props = withDefaults(defineProps<Props>(), {
  hubLink: '/labs/query',
})

const setupStartedAt = import.meta.client ? performance.now() : 0

const queryResult = await useConvexQuery(
  api.notes.list,
  {},
  {
    server: props.serverOption,
  },
)
const { data, pending, status, error } = queryResult

if (import.meta.client) {
  const fmtMs = (value: number) => `${Math.round(value)}ms`

  console.info(`[QueryLab:${props.pageId}] setup resolved`, {
    mode: 'blocking',
    server: props.serverOption,
    elapsed: fmtMs(performance.now() - setupStartedAt),
    status: status.value,
    pending: pending.value,
    error: error.value?.message ?? null,
    hasData: data.value !== undefined,
    dataLength: Array.isArray(data.value) ? data.value.length : null,
  })

  watch(
    [status, pending, data, error],
    ([nextStatus, nextPending, nextData, nextError], [prevStatus, prevPending]) => {
      console.info(`[QueryLab:${props.pageId}] state change`, {
        mode: 'blocking',
        elapsed: fmtMs(performance.now() - setupStartedAt),
        status: `${String(prevStatus)} -> ${String(nextStatus)}`,
        pending: `${String(prevPending)} -> ${String(nextPending)}`,
        error: nextError?.message ?? null,
        hasData: nextData !== null && nextData !== undefined,
        dataLength: Array.isArray(nextData) ? nextData.length : null,
      })
    },
  )
}

// Capture state at script execution time (frozen snapshot)
const capturedAtRender = {
  pending: pending.value,
  status: status.value,
  hasData: data.value !== undefined,
  dataLength: Array.isArray(data.value) ? data.value.length : null,
}
</script>

<template>
  <div :data-testid="pageId" class="test-page">
    <h1>{{ title }}</h1>
    <p class="description">{{ description }}</p>

    <NuxtLink :to="hubLink" class="back-link">Back to Hub</NuxtLink>

    <section class="state-section">
      <h2>Initial State (captured at render)</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">pending:</span>
          <span data-testid="initial-pending" class="value">{{ capturedAtRender.pending }}</span>
        </div>
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="initial-status" class="value">{{ capturedAtRender.status }}</span>
        </div>
        <div class="state-item">
          <span class="label">hasData:</span>
          <span data-testid="initial-has-data" class="value">{{ capturedAtRender.hasData }}</span>
        </div>
        <div class="state-item">
          <span class="label">dataLength:</span>
          <span data-testid="initial-data-length" class="value">{{
            capturedAtRender.dataLength
          }}</span>
        </div>
      </div>
    </section>

    <section class="state-section">
      <h2>Current State (reactive)</h2>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">pending:</span>
          <span data-testid="current-pending" class="value">{{ pending }}</span>
        </div>
        <div class="state-item">
          <span class="label">status:</span>
          <span data-testid="current-status" class="value">{{ status }}</span>
        </div>
        <div class="state-item">
          <span class="label">hasData:</span>
          <span data-testid="current-has-data" class="value">{{ data !== undefined }}</span>
        </div>
        <div class="state-item">
          <span class="label">dataLength:</span>
          <span data-testid="current-data-length" class="value">{{
            Array.isArray(data) ? data.length : null
          }}</span>
        </div>
      </div>
    </section>

    <section v-if="data" class="data-section">
      <h2>Data Preview</h2>
      <pre data-testid="data-preview">{{ JSON.stringify(data, null, 2) }}</pre>
    </section>
  </div>
</template>

<style scoped>
.test-page {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.description {
  color: #666;
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

.data-section {
  margin-top: 20px;
}

.data-section h2 {
  margin: 0 0 10px;
  font-size: 1.1rem;
  color: #374151;
}

.data-section pre {
  background: #f0f0f0;
  padding: 15px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  max-height: 200px;
}
</style>
