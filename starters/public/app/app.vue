<script setup lang="ts">
import { api } from '#convex/api'

const newText = ref('')
const { data: todos, status } = await useConvexQuery(api.todos.list)
const createTodo = useConvexMutation(api.todos.create)
const toggleTodo = useConvexMutation(api.todos.toggle)
const removeTodo = useConvexMutation(api.todos.remove)
const isCreating = createTodo.pending
const todoList = computed(() => todos.value ?? [])

async function addTodo() {
  const text = newText.value.trim()
  if (!text) return
  await createTodo({ text })
  newText.value = ''
}
</script>

<template>
  <main class="shell">
    <section class="panel">
      <header>
        <p class="eyebrow">Public starter</p>
        <h1>Todos</h1>
      </header>

      <form class="composer" @submit.prevent="addTodo">
        <input v-model="newText" maxlength="200" placeholder="Add a todo" aria-label="Todo text" />
        <button :disabled="isCreating || !newText.trim()">Add</button>
      </form>

      <p v-if="status === 'pending'" class="muted">Loading...</p>
      <ul v-else class="todos">
        <li v-for="todo in todoList" :key="todo._id">
          <label>
            <input
              type="checkbox"
              :checked="todo.completed"
              @change="toggleTodo({ id: todo._id })"
            />
            <span :class="{ done: todo.completed }">{{ todo.text }}</span>
          </label>
          <button class="ghost" @click="removeTodo({ id: todo._id })">Remove</button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style>
body {
  margin: 0;
  background: #f6f7f9;
  color: #18181b;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.panel {
  width: min(100%, 560px);
}

.eyebrow {
  margin: 0 0 8px;
  color: #5f6b7a;
  font-size: 14px;
}

h1 {
  margin: 0 0 24px;
  font-size: 36px;
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-bottom: 16px;
}

input,
button {
  height: 40px;
  border: 1px solid #d6dae1;
  border-radius: 6px;
  font: inherit;
}

input {
  padding: 0 12px;
  background: white;
}

button {
  padding: 0 14px;
  background: #18181b;
  color: white;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ghost {
  background: white;
  color: #3f3f46;
}

.todos {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.todos li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 0 0 12px;
  border: 1px solid #e1e5ea;
  border-radius: 8px;
  background: white;
}

.todos label {
  display: flex;
  align-items: center;
  gap: 10px;
}

.done {
  color: #71717a;
  text-decoration: line-through;
}

.muted {
  color: #71717a;
}
</style>
