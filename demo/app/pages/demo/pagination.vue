<script setup lang="ts">
import { api } from '@@/convex/_generated/api'

definePageMeta({
  middleware: 'auth',
})

// Tab state
const activeTab = ref('infinite')

// ============================================
// INFINITE SCROLL
// ============================================

const {
  data: infiniteResults,
  status: infiniteStatus,
  canLoadMore: infiniteCanLoadMore,
  loadMore: infiniteLoadMore,
  pending: infiniteLoading,
} = await useConvexPaginatedQuery(api.messages.listPaginated, {}, { initialNumItems: 10 })

const loadMoreRef = ref<HTMLElement | null>(null)

// Intersection Observer for infinite scroll
onMounted(() => {
  if (!loadMoreRef.value) return

  const observer = new IntersectionObserver(
    (entries) => {
      const [entry] = entries
      if (!entry) return
      if (entry.isIntersecting && infiniteCanLoadMore.value && !infiniteLoading.value) {
        infiniteLoadMore(5)
      }
    },
    { threshold: 0.1 },
  )

  observer.observe(loadMoreRef.value)
  onUnmounted(() => observer.disconnect())
})

// ============================================
// LOAD MORE BUTTON
// ============================================

const {
  data: buttonResults,
  status: buttonStatus,
  canLoadMore: buttonCanLoadMore,
  loadMore: buttonLoadMore,
  pending: buttonLoading,
} = await useConvexPaginatedQuery(api.messages.listPaginated, {}, { initialNumItems: 5 })

// ============================================
// ADD SAMPLE DATA
// ============================================

const seedMessages = useConvexMutation(api.messages.seed)
const seedStatus = seedMessages.status

async function addSampleData() {
  await seedMessages({ count: 20 })
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-2xl mx-auto">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">Pagination</h1>
      <p class="text-muted">Explore cursor-based pagination with await useConvexPaginatedQuery.</p>
    </div>

    <!-- Add sample data button -->
    <UAlert
      v-if="!infiniteResults?.length && !buttonResults?.length"
      class="mb-6"
      icon="i-lucide-database"
      color="secondary"
      variant="subtle"
    >
      <template #title>Need sample data?</template>
      <template #description>
        <p class="mb-3">Add some messages to test pagination.</p>
        <UButton size="sm" :loading="seedStatus === 'pending'" @click="addSampleData">
          Add 20 Messages
        </UButton>
      </template>
    </UAlert>

    <!-- Explanation -->
    <UAlert
      class="mb-6"
      icon="i-lucide-info"
      color="primary"
      variant="subtle"
      title="How it works"
      description="await useConvexPaginatedQuery uses cursor-based pagination. It efficiently loads data in chunks and supports both infinite scroll and manual load-more patterns."
    />

    <!-- Tabs -->
    <UTabs
      v-model="activeTab"
      :items="[
        { label: 'Infinite Scroll', value: 'infinite', icon: 'i-lucide-arrow-down' },
        { label: 'Load More Button', value: 'button', icon: 'i-lucide-plus' },
      ]"
      class="mb-6"
    />

    <!-- Infinite Scroll Panel -->
    <div v-if="activeTab === 'infinite'">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">Messages (Infinite Scroll)</span>
            <UBadge variant="subtle" color="neutral">
              {{ infiniteResults?.length || 0 }} loaded
            </UBadge>
          </div>
        </template>

        <div class="max-h-96 overflow-y-auto space-y-3">
          <div
            v-for="message in infiniteResults"
            :key="message._id"
            class="p-3 rounded-lg bg-elevated"
          >
            <p>{{ message.content }}</p>
            <p class="text-xs text-muted mt-1">
              {{ message.authorName }} &middot;
              {{ new Date(message.createdAt).toLocaleString() }}
            </p>
          </div>

          <!-- Intersection observer target -->
          <div ref="loadMoreRef" class="py-4 text-center">
            <UIcon
              v-if="infiniteLoading"
              name="i-lucide-loader-circle"
              class="size-5 animate-spin"
            />
            <p
              v-else-if="infiniteStatus === 'success' && !infiniteCanLoadMore"
              class="text-muted text-sm"
            >
              No more messages
            </p>
            <p v-else-if="infiniteCanLoadMore" class="text-muted text-sm">Scroll for more...</p>
          </div>
        </div>

        <p v-if="!infiniteResults?.length && !infiniteLoading" class="text-center text-muted py-8">
          No messages yet
        </p>
      </UCard>
    </div>

    <!-- Load More Button Panel -->
    <div v-if="activeTab === 'button'">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">Messages (Load More)</span>
            <UBadge variant="subtle" color="neutral">
              {{ buttonResults?.length || 0 }} loaded
            </UBadge>
          </div>
        </template>

        <div class="space-y-3">
          <div
            v-for="message in buttonResults"
            :key="message._id"
            class="p-3 rounded-lg bg-elevated"
          >
            <p>{{ message.content }}</p>
            <p class="text-xs text-muted mt-1">
              {{ message.authorName }} &middot;
              {{ new Date(message.createdAt).toLocaleString() }}
            </p>
          </div>
        </div>

        <div class="mt-4 text-center">
          <UButton
            v-if="buttonCanLoadMore"
            variant="outline"
            :loading="buttonLoading"
            @click="buttonLoadMore(5)"
          >
            Load More
          </UButton>
          <p v-else-if="buttonLoading" class="text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin mr-2 inline" />
            Loading...
          </p>
          <p v-else-if="buttonStatus === 'success'" class="text-muted text-sm">
            All messages loaded
          </p>
        </div>

        <p v-if="!buttonResults?.length && !buttonLoading" class="text-center text-muted py-8">
          No messages yet
        </p>
      </UCard>
    </div>

    <!-- Status Info -->
    <UCard class="mt-6">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-activity" class="w-5 h-5" />
          <span class="font-semibold">Query Status</span>
        </div>
      </template>

      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p class="text-muted">Infinite Scroll Status</p>
          <UBadge
            :color="
              infiniteStatus === 'success'
                ? 'success'
                : infiniteStatus === 'pending'
                  ? 'info'
                  : 'neutral'
            "
          >
            {{ infiniteStatus }}
          </UBadge>
        </div>
        <div>
          <p class="text-muted">Load More Status</p>
          <UBadge
            :color="
              buttonStatus === 'success'
                ? 'success'
                : buttonStatus === 'pending'
                  ? 'info'
                  : 'neutral'
            "
          >
            {{ buttonStatus }}
          </UBadge>
        </div>
      </div>
    </UCard>
  </div>
</template>
