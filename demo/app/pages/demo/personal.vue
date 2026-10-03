<script setup lang="ts">
import { api } from '@@/convex/_generated/api'

definePageMeta({
  middleware: 'auth',
})

const { data: tasks, status } = await useConvexQuery(api.tasks.listMine, {})

const input = ref('')
const { mutate: addTask, status: addStatus } = useConvexMutation(api.tasks.add)
const { mutate: toggleTask } = useConvexMutation(api.tasks.toggle)
const { mutate: deleteTask } = useConvexMutation(api.tasks.remove)
const { mutate: clearTasks, status: clearStatus } = useConvexMutation(api.tasks.clearAll)

async function add() {
  if (!input.value.trim()) return
  await addTask({ title: input.value })
  input.value = ''
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-2xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">My Tasks</h1>
      <p class="text-muted">Personal task list - only you can see and manage these tasks.</p>
    </div>

    <UAlert
      class="mb-6"
      icon="i-lucide-lock"
      color="secondary"
      variant="subtle"
      title="Private data"
      description="This demonstrates row-level security. Each user has their own private task list using the listMine query with user-scoped filtering."
    />

    <UCard>
      <form @submit.prevent="add" class="flex gap-2 mb-4">
        <UInput v-model="input" placeholder="Add a task..." class="flex-1" />
        <UButton type="submit" :loading="addStatus === 'pending'" :disabled="!input.trim()">
          Add
        </UButton>
      </form>

      <div v-if="status === 'pending'" class="space-y-2">
        <USkeleton v-for="i in 3" :key="i" class="h-10 w-full" />
      </div>

      <ul v-else-if="tasks?.length" class="space-y-2">
        <li
          v-for="task in tasks"
          :key="task._id"
          class="flex items-center gap-3 p-2 rounded-lg hover:bg-elevated group"
        >
          <UCheckbox
            :model-value="task.completed"
            @update:model-value="toggleTask({ id: task._id })"
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
            @click="void deleteTask({ id: task._id })"
          />
        </li>
      </ul>

      <p v-else class="text-center text-muted py-8">No tasks yet. Add one above!</p>

      <template #footer v-if="tasks?.length">
        <div class="flex justify-between items-center text-sm text-muted">
          <span>{{ tasks.length }} task{{ tasks.length === 1 ? '' : 's' }}</span>
          <UButton
            variant="ghost"
            size="xs"
            :loading="clearStatus === 'pending'"
            @click="void clearTasks({})"
          >
            Clear all
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
