<script setup lang="ts">
import { computed } from 'vue'

import type { EnhancedAuthState, AuthWaterfall, ConvexUser } from '../../types'
import { userDisplayName } from '../user-label'
import AuthWaterfallComponent from './AuthWaterfall.vue'

const props = defineProps<{
  authState: EnhancedAuthState | null
  waterfall?: AuthWaterfall | null
}>()

const user = computed<Partial<ConvexUser>>(() => props.authState?.user || {})

const displayName = computed(() => userDisplayName(user.value))

const avatarInitial = computed(() => (displayName.value || '?').charAt(0).toUpperCase())

const expirationDisplay = computed(() => {
  const expiresAt = props.authState?.expiresAt
  if (expiresAt === undefined) return '-'
  const iso = new Date(expiresAt).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
})
</script>

<template>
  <div id="auth-content">
    <!-- Not authenticated -->
    <div v-if="!authState?.isAuthenticated" class="auth-card">
      <div style="text-align: center; padding: 20px">
        <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.5">A</div>
        <div style="font-weight: 500; margin-bottom: 4px">Not Authenticated</div>
        <div style="color: var(--text-secondary); font-size: 12px">
          Log in to see authentication details
        </div>
      </div>
    </div>

    <!-- Authenticated -->
    <div v-else class="auth-card">
      <div class="auth-user">
        <div class="avatar">
          <img v-if="user.image" :src="user.image" alt="" />
          <template v-else>{{ avatarInitial }}</template>
        </div>
        <div class="user-details">
          <div class="user-name">{{ displayName || 'Unknown' }}</div>
          <div v-if="user.email && user.email !== displayName" class="user-email">
            {{ user.email }}
          </div>
        </div>
      </div>

      <div class="token-info">
        <div class="token-stat">
          <div
            class="token-stat-value badge"
            :class="
              authState.tokenStatus === 'valid'
                ? 'success'
                : authState.tokenStatus === 'expired'
                  ? 'error'
                  : 'pending'
            "
          >
            {{ authState.tokenStatus }}
          </div>
          <div class="token-stat-label">Token</div>
        </div>
        <div class="token-stat">
          <div class="token-stat-value" style="font-size: 12px; overflow-wrap: anywhere">
            {{ expirationDisplay }}
          </div>
          <div class="token-stat-label">Expires</div>
        </div>
      </div>
    </div>

    <!-- SSR Auth Waterfall (shown for all states when data available) -->
    <div v-if="waterfall" class="auth-card">
      <div class="detail-title">SSR Auth Waterfall</div>
      <AuthWaterfallComponent :waterfall="waterfall" />
    </div>
  </div>
</template>
