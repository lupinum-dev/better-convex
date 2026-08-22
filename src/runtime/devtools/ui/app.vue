<script setup lang="ts">
import { ref, onMounted } from 'vue'

import { useAuth } from './composables/useAuth'
import { useAuthProxy } from './composables/useAuthProxy'
import { useBridge } from './composables/useBridge'
import { useMutations } from './composables/useMutations'
import { useQueries } from './composables/useQueries'

const bridge = useBridge()

// Data composables
const { queries, selectedQueryId, selectQuery, getSelectedQuery } = useQueries(bridge)
const { mutations, toggleExpanded, isExpanded } = useMutations(bridge)
const { authState, connectionState, authWaterfall } = useAuth(bridge)
const { proxyStats, pending: proxyPending, clear: clearProxyStats } = useAuthProxy()

// UI state
const activeTab = ref<'queries' | 'mutations' | 'auth'>('queries')
const loading = ref(true)

onMounted(() => {
  // Short delay to allow connection
  setTimeout(() => {
    loading.value = false
  }, 500)
})

function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
}

function selectApplication(event: Event) {
  bridge.selectInstance((event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="app-shell">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <div class="logo">
          <img src="/convex-logo.svg" alt="Convex" width="18" height="18" class="logo-icon" />
          Convex DevTools
        </div>
      </div>
      <div class="status-bar">
        <select
          class="instance-select"
          :value="bridge.boundInstanceId.value || ''"
          aria-label="Application instance"
          @change="selectApplication"
        >
          <option value="" disabled>Select application</option>
          <option v-for="id in bridge.availableInstanceIds.value" :key="id" :value="id">
            {{ id }}
          </option>
        </select>
        <div class="status-item">
          <span
            class="status-dot"
            :class="connectionState?.isConnected ? 'connected' : 'disconnected'"
          />
          <span>{{ connectionState?.isConnected ? 'Connected' : 'Disconnected' }}</span>
        </div>
        <div class="status-item">
          <span
            class="status-dot"
            :class="{
              pending: authState?.pending,
              connected: authState?.isAuthenticated,
              disconnected: !authState?.pending && !authState?.isAuthenticated,
            }"
          />
          <span>
            {{
              authState?.pending
                ? 'Loading...'
                : authState?.isAuthenticated
                  ? authState.user?.name || 'Authenticated'
                  : 'Not authenticated'
            }}
          </span>
        </div>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="loading">
      <div class="spinner" />
      <span>Connecting to application...</span>
    </div>

    <!-- Main Content -->
    <template v-else>
      <!-- Tabs -->
      <nav class="tabs">
        <button
          class="tab"
          :class="{ active: activeTab === 'queries' }"
          @click="switchTab('queries')"
        >
          Queries <span class="tab-badge">{{ queries.length }}</span>
        </button>
        <button
          class="tab"
          :class="{ active: activeTab === 'mutations' }"
          @click="switchTab('mutations')"
        >
          Mutations <span class="tab-badge">{{ mutations.length }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'auth' }" @click="switchTab('auth')">
          Auth
        </button>
      </nav>

      <!-- Queries Tab -->
      <div v-show="activeTab === 'queries'" class="tab-content active">
        <div class="master-detail">
          <QueryList :queries="queries" :selected-id="selectedQueryId" @select="selectQuery" />
          <QueryDetail :query="getSelectedQuery()" />
        </div>
      </div>

      <!-- Mutations Tab -->
      <div v-show="activeTab === 'mutations'" class="tab-content active">
        <MutationTimeline
          :mutations="mutations"
          :is-expanded="isExpanded"
          @toggle="toggleExpanded"
        />
      </div>

      <!-- Auth Tab -->
      <div v-show="activeTab === 'auth'" class="tab-content active" style="overflow-y: auto">
        <AuthPanel :auth-state="authState" :waterfall="authWaterfall" />
        <AuthProxyPanel :stats="proxyStats" :loading="proxyPending" @clear="clearProxyStats" />
      </div>
    </template>
  </div>
</template>
