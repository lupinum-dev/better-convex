<template>
  <div class="container">
    <h1>My Tasks</h1>
    <p class="description">
      A simple task manager demonstrating <code>useConvexQuery</code> with real-time updates and
      <code>useConvexAuth</code> for authentication.
    </p>

    <div v-if="status === 'loading'" class="auth-warning">Checking session...</div>

    <div v-else-if="status === 'error'" class="auth-warning">
      {{ authError?.message ?? 'Authentication failed.' }}
    </div>

    <div v-else-if="status === 'anonymous'" class="auth-warning">
      <p>Please <NuxtLink to="/auth/signin">sign in</NuxtLink> to view your tasks.</p>
    </div>

    <template v-else>
      <!-- Status bar -->
      <div class="status-bar">
        <span
          class="badge"
          :class="{ loading: pending, success: !pending && !error, error: error }"
        >
          {{ pending ? 'Loading...' : error ? 'Error' : 'Ready' }}
        </span>
        <span class="info">Real-time updates enabled</span>
      </div>

      <!-- Add task form -->
      <form class="add-form" @submit.prevent="addTask">
        <input
          v-model="newTaskTitle"
          type="text"
          placeholder="What needs to be done?"
          :disabled="isAdding"
        />
        <button type="submit" :disabled="!newTaskTitle.trim() || isAdding">
          {{ isAdding ? 'Adding...' : 'Add' }}
        </button>
      </form>

      <!-- Error display -->
      <div v-if="error" class="error-box">
        {{ error.message }}
      </div>

      <!-- Tasks list -->
      <div v-else-if="!tasks || tasks.length === 0" class="empty">
        <p>No tasks yet. Add one above!</p>
      </div>

      <ul v-else class="task-list">
        <li v-for="task in tasks" :key="task._id" :class="{ completed: task.completed }">
          <label>
            <input type="checkbox" :checked="task.completed" @change="toggleTask(task._id)" />
            <span>{{ task.title }}</span>
          </label>
          <button class="delete" @click="deleteTask(task._id)">x</button>
        </li>
      </ul>

      <p class="meta">{{ tasks?.length ?? 0 }} task{{ (tasks?.length ?? 0) !== 1 ? 's' : '' }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '~/convex/_generated/dataModel'

definePageMeta({
  layout: 'sidebar',
})

const { status, error: authError } = useConvexAuth()
// Use useConvexQuery for SSR + real-time updates!
// Skip query when not authenticated
const queryArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))

const { data: tasks, pending, error } = await useConvexQuery(api.tasks.list, queryArgs)

// Client-only state
const newTaskTitle = ref('')
const isAdding = ref(false)

// useConvex() is client-only; the handle is used exclusively from browser
// event handlers, so capture it during client setup and guard SSR.
const convexHandle = import.meta.client ? useConvex() : null
function getConvexClient() {
  if (!convexHandle) {
    throw new Error('Convex client unavailable')
  }
  return convexHandle
}

// Add a new task
async function addTask() {
  if (!newTaskTitle.value.trim()) return

  isAdding.value = true
  try {
    const client = getConvexClient()
    await client.mutation(api.tasks.add, { title: newTaskTitle.value.trim() })
    newTaskTitle.value = ''
    // Real-time subscription updates automatically!
  } catch (e) {
    console.error('Failed to add task:', e)
  } finally {
    isAdding.value = false
  }
}

// Toggle task completion
async function toggleTask(id: Id<'tasks'>) {
  try {
    const client = getConvexClient()
    await client.mutation(api.tasks.toggle, { id })
    // Real-time subscription updates automatically!
  } catch (e) {
    console.error('Failed to toggle task:', e)
  }
}

// Delete a task
async function deleteTask(id: Id<'tasks'>) {
  try {
    const client = getConvexClient()
    await client.mutation(api.tasks.remove, { id })
    // Real-time subscription updates automatically!
  } catch (e) {
    console.error('Failed to delete task:', e)
  }
}
</script>

<style scoped>
.container {
  max-width: 600px;
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

.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.badge.loading {
  background: #fef3c7;
  color: #92400e;
}

.badge.success {
  background: #d1fae5;
  color: #065f46;
}

.badge.error {
  background: #fee2e2;
  color: #991b1b;
}

.info {
  color: #6b7280;
  font-size: 0.85rem;
}

.error-box {
  background: #fee2e2;
  color: #991b1b;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.auth-warning {
  background: #fff3cd;
  color: #856404;
  padding: 16px;
  border-radius: 8px;
}

.auth-warning a {
  color: #533f03;
  font-weight: bold;
}

.add-form {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.add-form input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 16px;
}

.add-form button {
  padding: 10px 20px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
}

.add-form button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.empty {
  text-align: center;
  color: #666;
  padding: 40px;
  background: #f8f8f8;
  border-radius: 8px;
}

.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
  background: #f8f8f8;
  border-radius: 8px;
}

.task-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.task-list li:last-child {
  border-bottom: none;
}

.task-list li label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  flex: 1;
}

.task-list li.completed span {
  text-decoration: line-through;
  color: #999;
}

.task-list li .delete {
  background: none;
  border: none;
  color: #dc2626;
  font-size: 18px;
  cursor: pointer;
  padding: 0 8px;
  opacity: 0.5;
}

.task-list li .delete:hover {
  opacity: 1;
}

.meta {
  margin-top: 20px;
  color: #666;
  font-size: 0.9em;
  text-align: center;
}
</style>
