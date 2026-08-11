<script setup lang="ts">
import { emptyQueryArgs, subscriptionDedupCounterQuery } from '~~/utils/subscription-dedup-harness'

const props = withDefaults(
  defineProps<{
    prefix: string
    label: string
    delayed?: boolean
    delayMs?: number
  }>(),
  {
    delayed: false,
    delayMs: 50,
  },
)

const ready = ref(!props.delayed)
let readyTimer: ReturnType<typeof setTimeout> | null = null

const queryArgs = computed<Record<string, never> | 'skip'>(() =>
  ready.value ? emptyQueryArgs : 'skip',
)

const result = await useConvexQuery(subscriptionDedupCounterQuery, queryArgs, { server: false })

const { data, status, error } = result

onMounted(() => {
  if (!props.delayed) return
  readyTimer = setTimeout(() => {
    ready.value = true
  }, props.delayMs)
})

onUnmounted(() => {
  if (readyTimer) {
    clearTimeout(readyTimer)
  }
})
</script>

<template>
  <div class="subscriber-card" :data-testid="`${prefix}-card`">
    <h2 class="title">{{ label }}</h2>
    <div class="rows">
      <div class="row">
        <span class="label">ready:</span>
        <span class="value" :data-testid="`${prefix}-ready`">{{ ready }}</span>
      </div>
      <div class="row">
        <span class="label">status:</span>
        <span class="value" :data-testid="`${prefix}-status`">{{ status }}</span>
      </div>
      <div class="row">
        <span class="label">data:</span>
        <span class="value" :data-testid="`${prefix}-count`">{{ data ?? 'null' }}</span>
      </div>
      <div class="row">
        <span class="label">error:</span>
        <span class="value" :data-testid="`${prefix}-error`">{{ error?.message ?? 'null' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subscriber-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.title {
  margin: 0 0 10px;
  font-size: 1rem;
}

.rows {
  display: grid;
  gap: 6px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.label {
  min-width: 52px;
  color: #6b7280;
}

.value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 2px 6px;
}
</style>
