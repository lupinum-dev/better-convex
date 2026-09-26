<script setup lang="ts">
import { computed } from 'vue'

import type { AuthWaterfall, AuthWaterfallPhase } from '../../types'

const props = defineProps<{
  waterfall: AuthWaterfall | null
}>()

// Color mapping for phase results (fallback for unknown phases)
const resultColors: Record<AuthWaterfallPhase['result'], string> = {
  miss: 'var(--warning)',
  success: 'var(--accent)',
  error: 'var(--error)',
}

// Distinct colors for each phase (waterfall style)
const phaseColors: Record<string, string> = {
  'session-check': '#3b82f6', // Blue
  'token-exchange': '#f59e0b', // Amber
  'jwt-decode': '#10b981', // Emerald
}

// Phase display names
const phaseNames: Record<string, string> = {
  'session-check': 'Session',
  'token-exchange': 'Token Exchange',
  'jwt-decode': 'JWT Decode',
}

// Get color for a phase (use phase-specific color, or fall back to result-based)
const getPhaseColor = (phase: AuthWaterfallPhase): string => {
  // Errors always use the result color
  if (phase.result === 'error') return resultColors.error
  // Otherwise use phase-specific color
  return phaseColors[phase.name] || resultColors[phase.result]
}

const totalDuration = computed(() => {
  if (!props.waterfall) return 0
  return props.waterfall.totalDuration
})

// Calculate bar widths as percentages
const phaseWidths = computed(() => {
  if (!props.waterfall || totalDuration.value === 0) return []

  return props.waterfall.phases.map((phase) => ({
    ...phase,
    displayName: phaseNames[phase.name] || phase.name,
    width: Math.max(2, (phase.duration / totalDuration.value) * 100), // Min 2% for visibility
    color: getPhaseColor(phase),
  }))
})

const outcomeColor = computed(() => {
  if (!props.waterfall) return 'var(--text-secondary)'
  switch (props.waterfall.outcome) {
    case 'authenticated':
      return 'var(--success)'
    case 'unauthenticated':
      return 'var(--warning)'
    case 'error':
      return 'var(--error)'
    default:
      return 'var(--text-secondary)'
  }
})

const formatTime = (ms: number) => {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
</script>

<template>
  <div class="waterfall-container">
    <!-- No waterfall data -->
    <div v-if="!waterfall" class="waterfall-empty">
      <div style="opacity: 0.5; margin-bottom: 8px">No SSR auth data</div>
      <div style="font-size: 11px; color: var(--text-secondary)">
        Auth waterfall is only captured during SSR requests
      </div>
    </div>

    <!-- Waterfall display -->
    <template v-else>
      <!-- Summary row -->
      <div class="waterfall-summary">
        <div class="summary-item">
          <span class="summary-label">Total</span>
          <span class="summary-value">{{ formatTime(waterfall.totalDuration) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Result</span>
          <span class="summary-value" :style="{ color: outcomeColor }">
            {{ waterfall.outcome }}
          </span>
        </div>
      </div>

      <!-- Bar chart -->
      <div class="waterfall-chart">
        <div
          v-for="(phase, index) in phaseWidths"
          :key="index"
          class="waterfall-bar"
          :style="{
            width: phase.width + '%',
            backgroundColor: phase.color,
          }"
          :title="`${phase.displayName}: ${formatTime(phase.duration)} (${phase.result})`"
        />
      </div>

      <!-- Legend -->
      <div class="waterfall-legend">
        <div v-for="(phase, index) in phaseWidths" :key="index" class="legend-item">
          <span class="legend-dot" :style="{ backgroundColor: phase.color }" />
          <span class="legend-name">{{ phase.displayName }}</span>
          <span class="legend-time">{{ formatTime(phase.duration) }}</span>
          <span v-if="phase.details" class="legend-details">{{ phase.details }}</span>
        </div>
      </div>

      <!-- Error message if present -->
      <div v-if="waterfall.error" class="waterfall-error">
        {{ waterfall.error }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.waterfall-container {
  padding: 12px 0;
}

.waterfall-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-secondary);
}

.waterfall-summary {
  display: flex;
  gap: 20px;
  margin-bottom: 12px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.summary-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.summary-value {
  font-size: 14px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}

.waterfall-chart {
  display: flex;
  height: 24px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-tertiary);
  margin-bottom: 12px;
}

.waterfall-bar {
  height: 100%;
  min-width: 4px;
  transition: opacity 0.15s;
  cursor: default;
}

.waterfall-bar:hover {
  opacity: 0.8;
}

.waterfall-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-name {
  font-weight: 500;
  min-width: 100px;
}

.legend-time {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  color: var(--text-secondary);
  min-width: 50px;
}

.legend-details {
  color: var(--text-secondary);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.waterfall-error {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--error-bg);
  color: var(--error);
  border-radius: 4px;
  font-size: 12px;
}
</style>
