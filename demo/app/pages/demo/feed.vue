<script setup lang="ts">
import { api } from '@@/convex/_generated/api'

definePageMeta({
  middleware: 'auth',
})

const { can } = await useDemoPermissions()

// Real-time feed subscription (blocking setup by default)
const { data: feedItems, status } = await useConvexQuery(api.feed.list, {})

// Add item mutation
const { mutate: addItem, status: addStatus } = useConvexMutation(api.feed.add)

// Delete mutation
const { mutate: deleteItem } = useConvexMutation(api.feed.remove)

// Form state
const content = ref('')
const itemType = ref<'message' | 'task' | 'event'>('message')

// Error state
const error = ref<{ title: string; description: string } | null>(null)

const typeOptions = [
  { value: 'message', label: 'Message', icon: 'i-lucide-message-circle' },
  { value: 'task', label: 'Task', icon: 'i-lucide-check-square' },
  { value: 'event', label: 'Event', icon: 'i-lucide-calendar' },
]

async function submitItem() {
  if (!content.value.trim()) return
  error.value = null

  try {
    await addItem({
      content: content.value,
      type: itemType.value,
    })
    content.value = ''
  } catch (e: any) {
    const message = e.message || 'Failed to create post'
    if (message.includes('Permission denied')) {
      error.value = {
        title: 'Permission Denied',
        description: message.replace('Permission denied: ', ''),
      }
    } else {
      error.value = {
        title: 'Error',
        description: message,
      }
    }
  }
}

async function handleDelete(itemId: string) {
  error.value = null

  try {
    await deleteItem({ id: itemId as any })
  } catch (e: any) {
    const message = e.message || 'Failed to delete post'
    if (message.includes('Permission denied')) {
      error.value = {
        title: 'Permission Denied',
        description: message.replace('Permission denied: ', ''),
      }
    } else {
      error.value = {
        title: 'Error',
        description: message,
      }
    }
  }
}

const typeIcons: Record<string, string> = {
  message: 'i-lucide-message-circle',
  task: 'i-lucide-check-square',
  event: 'i-lucide-calendar',
}

function canDelete(item: { authorId: string }) {
  return can('feed.delete', { ownerId: item.authorId })
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-2xl mx-auto">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">Real-time Feed</h1>
      <p class="text-muted">
        Watch updates appear instantly. Try opening this page in another browser tab!
      </p>
    </div>

    <!-- Tip Alert -->
    <UAlert
      class="mb-6"
      icon="i-lucide-info"
      color="secondary"
      variant="subtle"
      title="How it works"
      description="await useConvexQuery creates a live subscription after initial blocking fetch. Any changes to the data are pushed instantly to all connected clients."
    />

    <!-- Input Form -->
    <UCard v-if="can('feed.create')" class="mb-6">
      <form @submit.prevent="submitItem" class="space-y-4">
        <div class="flex gap-3">
          <USelect v-model="itemType" :items="typeOptions" value-key="value" class="w-36" />
          <UInput v-model="content" placeholder="What's happening?" class="flex-1" />
          <UButton type="submit" :loading="addStatus === 'pending'" :disabled="!content.trim()">
            Post
          </UButton>
        </div>
      </form>
    </UCard>

    <!-- Error Alert -->
    <UAlert
      v-if="error"
      class="mb-6"
      icon="i-lucide-alert-circle"
      color="error"
      variant="subtle"
      :title="error.title"
      :description="error.description"
      close
      @update:open="error = null"
    />

    <UAlert
      v-else
      class="mb-6"
      icon="i-lucide-lock"
      color="warning"
      variant="subtle"
      title="Permission required"
      description="Sign in with the demo permission context to create posts."
    />

    <!-- Feed List -->
    <div class="space-y-3">
      <!-- Loading state -->
      <template v-if="status === 'pending'">
        <USkeleton v-for="i in 5" :key="i" class="h-20 w-full" />
      </template>

      <!-- Empty state -->
      <UCard v-else-if="!feedItems?.length" class="text-center py-8">
        <UIcon name="i-lucide-inbox" class="w-12 h-12 text-muted mx-auto mb-4" />
        <p class="text-muted">No items yet. Be the first to post!</p>
      </UCard>

      <!-- Feed items -->
      <TransitionGroup v-else name="list">
        <UCard v-for="item in feedItems" :key="item._id" class="group">
          <div class="flex gap-4">
            <div
              class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"
            >
              <UIcon :name="typeIcons[item.type]" class="w-5 h-5 text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <p>{{ item.content }}</p>
              <p class="text-sm text-muted mt-1">
                {{ item.authorName || 'Anonymous' }} &middot;
                {{ new Date(item.createdAt).toLocaleTimeString() }}
              </p>
            </div>
            <UButton
              v-if="canDelete(item)"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              :class="['size-10 min-w-0 p-0 flex items-center justify-center']"
              size="sm"
              @click="handleDelete(item._id)"
            />
          </div>
        </UCard>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}
.list-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.list-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
