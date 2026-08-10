<template>
  <div class="container">
    <h1>Connection Lab</h1>
    <p class="description">
      This page tests the <code>useConvexConnectionState</code> composable. Try going offline
      (DevTools > Network > Offline) to see the state change.
    </p>

    <div class="status-card" :class="statusClass">
      <div class="status-indicator" />
      <div class="status-text">
        <strong>{{ statusLabel }}</strong>
        <span v-if="isReconnecting"> (attempt {{ connectionRetries }})</span>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="label">WebSocket Connected</span>
        <span class="value" :class="{ positive: isConnected }">{{
          isConnected ? 'Yes' : 'No'
        }}</span>
      </div>
      <div class="stat">
        <span class="label">Has Ever Connected</span>
        <span class="value" :class="{ positive: hasEverConnected }">{{
          hasEverConnected ? 'Yes' : 'No'
        }}</span>
      </div>
      <div class="stat">
        <span class="label">Connection Retries</span>
        <span class="value">{{ connectionRetries }}</span>
      </div>
      <div class="stat">
        <span class="label">Application Offline Banner</span>
        <span class="value" :class="{ active: showOfflineBanner }">{{
          showOfflineBanner ? 'Yes' : 'No'
        }}</span>
      </div>
      <div class="stat">
        <span class="label">Inflight Requests</span>
        <span class="value" :class="{ active: hasInflightRequests }">{{
          hasInflightRequests ? 'Yes' : 'No'
        }}</span>
      </div>
      <div class="stat">
        <span class="label">Inflight Mutations</span>
        <span class="value">{{ inflightMutations }}</span>
      </div>
      <div class="stat">
        <span class="label">Inflight Actions</span>
        <span class="value">{{ inflightActions }}</span>
      </div>
    </div>

    <div class="raw-state">
      <h3>Raw State</h3>
      <pre>{{ JSON.stringify(state, null, 2) }}</pre>
    </div>

    <div class="test-actions">
      <h3>Test Actions</h3>
      <p>Trigger a mutation to see inflight state:</p>
      <button :disabled="addingNote" @click="triggerMutation">
        {{ addingNote ? 'Adding...' : 'Add Test Note' }}
      </button>
      <span v-if="lastNoteId" class="success">Added note: {{ lastNoteId }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

const { state, isConnected, isReconnecting, pendingMutations, pendingActions } =
  useConvexConnectionState()

const hasEverConnected = computed(() => state.value.hasEverConnected)
const connectionRetries = computed(() => state.value.connectionRetries)
const hasInflightRequests = computed(() => state.value.hasInflightRequests)
const inflightMutations = pendingMutations
const inflightActions = pendingActions

// Presentation timing belongs to the application, not the transport composable.
const showOfflineBanner = ref(false)
let offlineTimer: ReturnType<typeof setTimeout> | undefined
let stopOfflineWatch: (() => void) | undefined
onMounted(() => {
  stopOfflineWatch = watch(
    isConnected,
    (connected) => {
      clearTimeout(offlineTimer)
      if (connected) {
        showOfflineBanner.value = false
        return
      }
      offlineTimer = setTimeout(() => {
        showOfflineBanner.value = true
      }, 500)
    },
    { immediate: true },
  )
})
onBeforeUnmount(() => {
  stopOfflineWatch?.()
  clearTimeout(offlineTimer)
})

const statusClass = computed(() => {
  if (isReconnecting.value) return 'reconnecting'
  if (isConnected.value) return 'connected'
  return 'disconnected'
})

const statusLabel = computed(() => {
  if (isReconnecting.value) return 'Reconnecting...'
  if (isConnected.value) return 'Connected'
  return 'Disconnected'
})

// Test mutation to see inflight state
const addNote = useConvexMutation(api.notes.add)
const { pending: addingNote } = addNote
const lastNoteId = ref<string | null>(null)

async function triggerMutation() {
  const id = await addNote({
    title: `Test Note ${Date.now()}`,
    content: 'Created to test connection state inflight tracking',
  })
  lastNoteId.value = id
}
</script>

<style scoped>
.container {
  max-width: 700px;
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

.status-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 12px;
  margin-bottom: 24px;
  transition: all 0.3s ease;
}

.status-card.connected {
  background: #e8f5e9;
  border: 2px solid #4caf50;
}

.status-card.disconnected {
  background: #ffebee;
  border: 2px solid #f44336;
}

.status-card.reconnecting {
  background: #fff3e0;
  border: 2px solid #ff9800;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.status-indicator {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  transition: background-color 0.3s ease;
}

.connected .status-indicator {
  background: #4caf50;
}
.disconnected .status-indicator {
  background: #f44336;
}
.reconnecting .status-indicator {
  background: #ff9800;
}

.status-text {
  font-size: 1.1em;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.stat {
  background: #f5f5f5;
  padding: 12px 16px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat .label {
  font-size: 0.85em;
  color: #666;
}

.stat .value {
  font-size: 1.1em;
  font-weight: 600;
}

.stat .value.positive {
  color: #4caf50;
}
.stat .value.active {
  color: #2196f3;
}

.raw-state {
  margin-bottom: 24px;
}

.raw-state h3 {
  margin-bottom: 8px;
  font-size: 1em;
}

.raw-state pre {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 16px;
  border-radius: 8px;
  overflow: auto;
  font-size: 0.85em;
}

.test-actions {
  background: #f0f7ff;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 24px;
}

.test-actions h3 {
  margin: 0 0 8px 0;
  font-size: 1em;
}

.test-actions p {
  margin: 0 0 12px 0;
  color: #666;
}

.test-actions button {
  background: #2196f3;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 1em;
  cursor: pointer;
  transition: background 0.2s;
}

.test-actions button:hover:not(:disabled) {
  background: #1976d2;
}

.test-actions button:disabled {
  background: #90caf9;
  cursor: not-allowed;
}

.success {
  margin-left: 12px;
  color: #4caf50;
  font-size: 0.9em;
}
</style>
