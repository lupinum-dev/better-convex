<script setup lang="ts">
import { api } from '@@/convex/_generated/api'
import type { Id } from '@@/convex/_generated/dataModel'

definePageMeta({
  middleware: 'auth',
})

// Shared task list query
const { data: tasks, status } = await useConvexQuery(api.tasks.list, {})

// ============================================
// STANDARD MUTATIONS (left panel)
// ============================================

const standardInput = ref('')
const standardAdd = useConvexMutation(api.tasks.add)
const standardAddStatus = standardAdd.status
const standardToggle = useConvexMutation(api.tasks.toggle)
const standardDelete = useConvexMutation(api.tasks.remove)

async function addStandard() {
  if (!standardInput.value.trim()) return
  await standardAdd({ title: standardInput.value })
  standardInput.value = ''
}

// ============================================
// OPTIMISTIC MUTATIONS (right panel)
// ============================================

const optimisticInput = ref('')

const optimisticAdd = useConvexMutation(api.tasks.add, {
  optimisticUpdate: (localStore, args) => {
    const current = localStore.getQuery(api.tasks.list, {})
    const now = Date.now()
    const optimisticTask = {
      _id: `temp-${now}` as Id<'tasks'>,
      _creationTime: now,
      title: `${args.title} (optimistic)`,
      completed: false,
      userId: 'pending',
      createdAt: now,
    }
    localStore.setQuery(api.tasks.list, {}, [optimisticTask, ...(current ?? [])])
  },
})
const optimisticAddStatus = optimisticAdd.status

const optimisticToggle = useConvexMutation(api.tasks.toggle, {
  optimisticUpdate: (localStore, args) => {
    const current = localStore.getQuery(api.tasks.list, {})
    localStore.setQuery(
      api.tasks.list,
      {},
      current?.map((task) =>
        task._id === args.id ? { ...task, completed: !task.completed } : task,
      ),
    )
  },
})

const optimisticDelete = useConvexMutation(api.tasks.remove, {
  optimisticUpdate: (localStore, args) => {
    const current = localStore.getQuery(api.tasks.list, {})
    localStore.setQuery(
      api.tasks.list,
      {},
      current?.filter((task) => task._id !== args.id),
    )
  },
})

async function addOptimistic() {
  if (!optimisticInput.value.trim()) return
  await optimisticAdd({ title: optimisticInput.value })
  optimisticInput.value = ''
}

// Check if task is optimistic (temp ID)
function isOptimistic(taskId: string) {
  return taskId.startsWith('temp-')
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-5xl mx-auto">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">Optimistic Updates</h1>
      <p class="text-muted">Compare standard mutations (left) with optimistic updates (right).</p>
    </div>

    <!-- Explanation -->
    <UAlert
      class="mb-6"
      icon="i-lucide-info"
      color="secondary"
      variant="subtle"
      title="How it works"
      description="Optimistic updates predict the result before the server responds, making the UI feel instant. If the server returns an error, the change is automatically rolled back."
    />

    <!-- Side by side comparison -->
    <div class="grid gap-6 md:grid-cols-2">
      <!-- Standard Panel -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-clock" class="w-5 h-5 text-orange-500" />
            <span class="font-semibold">Standard (Wait for Server)</span>
          </div>
        </template>

        <form @submit.prevent="addStandard" class="flex gap-2 mb-4">
          <UInput v-model="standardInput" placeholder="Add task..." class="flex-1" />
          <UButton
            type="submit"
            :loading="standardAddStatus === 'pending'"
            :disabled="!standardInput.trim()"
          >
            Add
          </UButton>
        </form>

        <div v-if="status === 'pending'" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-10 w-full" />
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="task in tasks"
            :key="task._id"
            class="flex items-center gap-3 p-2 rounded-lg hover:bg-elevated group"
          >
            <UCheckbox
              :model-value="task.completed"
              @update:model-value="standardToggle({ id: task._id })"
            />
            <span :class="{ 'line-through text-muted': task.completed }" class="flex-1">
              {{ task.title }}
            </span>
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              class="opacity-0 group-hover:opacity-100"
              @click="void standardDelete({ id: task._id })"
            />
          </li>
        </ul>

        <p v-if="tasks && !tasks.length" class="text-center text-muted py-4">No tasks yet</p>
      </UCard>

      <!-- Optimistic Panel -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-zap" class="w-5 h-5 text-green-500" />
            <span class="font-semibold">Optimistic (Instant)</span>
          </div>
        </template>

        <form @submit.prevent="addOptimistic" class="flex gap-2 mb-4">
          <UInput v-model="optimisticInput" placeholder="Add task..." class="flex-1" />
          <UButton
            type="submit"
            color="success"
            :loading="optimisticAddStatus === 'pending'"
            :disabled="!optimisticInput.trim()"
          >
            Add
          </UButton>
        </form>

        <div v-if="status === 'pending'" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-10 w-full" />
        </div>

        <ul v-else class="space-y-2">
          <li
            v-for="task in tasks"
            :key="task._id"
            :class="[
              'flex items-center gap-3 p-2 rounded-lg group',
              isOptimistic(task._id)
                ? 'bg-green-500/10 border border-green-500/20'
                : 'hover:bg-elevated',
            ]"
          >
            <UIcon
              v-if="isOptimistic(task._id)"
              name="i-lucide-loader-2"
              class="w-4 h-4 text-green-500 animate-spin"
            />
            <UCheckbox
              v-else
              :model-value="task.completed"
              @update:model-value="optimisticToggle({ id: task._id })"
            />
            <span :class="{ 'line-through text-muted': task.completed }" class="flex-1">
              {{ task.title }}
            </span>
            <UButton
              v-if="!isOptimistic(task._id)"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              class="opacity-0 group-hover:opacity-100"
              @click="void optimisticDelete({ id: task._id })"
            />
          </li>
        </ul>

        <p v-if="tasks && !tasks.length" class="text-center text-muted py-4">No tasks yet</p>
      </UCard>
    </div>

    <!-- Code Example -->
    <UCard class="mt-6">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-code" class="w-5 h-5" />
          <span class="font-semibold">Code Example</span>
        </div>
      </template>

      <pre
        class="text-xs bg-elevated p-4 rounded-lg overflow-x-auto"
      ><code>const addTask = useConvexMutation(api.tasks.add, {
  optimisticUpdate: (localStore, args) => {
    const current = localStore.getQuery(api.tasks.list, {})
    localStore.setQuery(api.tasks.list, {}, [
      { _id: 'temp', title: args.title, completed: false },
      ...(current ?? [])
    ])
  }
})</code></pre>
    </UCard>
  </div>
</template>
