<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({ convexAuth: true })

const { user, client } = useConvexAuth()
const text = ref('')
const { data: todos, status, error } = useConvexQuery(api.todos.list, {}, { auth: 'required' })
const { mutate: createTodo, pending: creating, error: createError } = useConvexMutation(
  api.todos.create,
)
const { mutate: toggleTodo, error: toggleError } = useConvexMutation(api.todos.toggle)
const { mutate: removeTodo, error: removeError } = useConvexMutation(api.todos.remove)
const callError = computed(() => createError.value ?? toggleError.value ?? removeError.value)

async function add() {
  try {
    await createTodo({ text: text.value })
    text.value = ''
  } catch {
    // createError holds the error. The template shows it.
  }
}

async function signOut() {
  await client.signOut()
  await navigateTo('/')
}
</script>

<template>
  <main>
    <p v-if="user" class="muted">
      Signed in as {{ user.email }}
      <button @click="signOut">Sign out</button>
    </p>
    <h1>Todos</h1>

    <form @submit.prevent="add">
      <input v-model="text" maxlength="200" placeholder="What needs doing?" aria-label="Todo" />
      <button :disabled="creating || !text.trim()">Add</button>
    </form>
    <p v-if="callError" class="error">{{ callError.message }}</p>

    <p v-if="status === 'pending'" class="muted">Loading todos…</p>
    <p v-else-if="error" class="error">Could not load the todos.</p>
    <p v-else-if="todos?.length === 0" class="muted">No todos yet. Add the first one.</p>
    <ul v-else>
      <li v-for="todo in todos" :key="todo._id">
        <input
          type="checkbox"
          :checked="todo.completed"
          :aria-label="`Done: ${todo.text}`"
          @change="toggleTodo({ todoId: todo._id }).catch(() => {})"
        />
        <span :class="{ done: todo.completed }">{{ todo.text }}</span>
        <button @click="removeTodo({ todoId: todo._id }).catch(() => {})">Delete</button>
      </li>
    </ul>
  </main>
</template>
