<template>
  <div class="permissions-demo">
    <header class="header">
      <h1>Permissions Demo</h1>
      <p class="subtitle">
        A userland <code>usePermissions()</code> composable built on <code>useConvexQuery</code> —
        this module ships no permissions runtime. This playground does not enable the Better Auth
        Organization plugin, so there are no org roles — <code>can()</code> gates on being signed in
        and owning the resource. See the docs for the full Better Auth org model.
      </p>
    </header>

    <div v-if="pending" class="state">Loading permission context…</div>

    <div v-else-if="!isAuthenticated" class="state">
      <p>You are signed out. <NuxtLink to="/auth/signin">Sign in</NuxtLink> to try the demo.</p>
    </div>

    <template v-else>
      <section class="section">
        <h2>Context</h2>
        <div class="context">
          <span class="badge">userId: {{ user?.userId }}</span>
        </div>
      </section>

      <section class="section">
        <h2>Global checks (no resource)</h2>
        <ul class="checks">
          <li :class="{ allowed: can('post.create') }">
            <code>can('post.create')</code>
            <span class="status">{{ can('post.create') ? '✓' : '✗' }}</span>
          </li>
          <li :class="{ allowed: can('post.read') }">
            <code>can('post.read')</code>
            <span class="status">{{ can('post.read') ? '✓' : '✗' }}</span>
          </li>
        </ul>
      </section>

      <section class="section">
        <h2>Your posts (ownership checks)</h2>

        <form v-if="can('post.create')" class="create" @submit.prevent="createPost">
          <input v-model="newTitle" placeholder="Post title" />
          <button type="submit" :disabled="!newTitle.trim() || creating">Create</button>
        </form>

        <p v-if="!posts?.length" class="state">No posts yet.</p>

        <ul v-else class="posts">
          <li v-for="post in posts" :key="post._id" class="post">
            <div class="post-main">
              <strong>{{ post.title }}</strong>
              <span class="pill">{{ post.status }}</span>
            </div>
            <div class="actions">
              <button v-if="can('post.update', post)" @click="rename(post._id)">Rename</button>
              <button
                v-if="can('post.publish', post) && post.status === 'draft'"
                @click="publish(post._id)"
              >
                Publish
              </button>
              <button v-if="can('post.delete', post)" @click="remove(post._id)">Delete</button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '~/convex/_generated/dataModel'

definePageMeta({
  layout: 'sidebar',
})

const { can, user, pending, isAuthenticated } = await usePermissions()

const listArgs = computed(() => (isAuthenticated.value ? {} : 'skip'))
const { data: posts } = await useConvexQuery(api.posts.list, listArgs)

const { mutate: createMutation } = useConvexMutation(api.posts.create)
const { mutate: updateMutation } = useConvexMutation(api.posts.update)
const { mutate: publishMutation } = useConvexMutation(api.posts.publish)
const { mutate: removeMutation } = useConvexMutation(api.posts.remove)

const newTitle = ref('')
const creating = ref(false)

async function createPost() {
  if (!newTitle.value.trim()) return
  creating.value = true
  try {
    await createMutation({ title: newTitle.value.trim(), content: 'Created from the demo.' })
    newTitle.value = ''
  } finally {
    creating.value = false
  }
}

async function rename(id: Id<'posts'>) {
  await updateMutation({ id, title: `Renamed ${new Date().toLocaleTimeString()}` })
}

async function publish(id: Id<'posts'>) {
  await publishMutation({ id })
}

async function remove(id: Id<'posts'>) {
  await removeMutation({ id })
}
</script>

<style scoped>
.permissions-demo {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1rem;
}
.header h1 {
  margin: 0 0 0.5rem;
}
.subtitle {
  color: #6b7280;
  line-height: 1.5;
}
.section {
  margin-top: 2rem;
}
.section h2 {
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
}
.state {
  color: #6b7280;
  padding: 1rem 0;
}
.badge,
.pill {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: #eef2ff;
  color: #4338ca;
  font-size: 0.85rem;
}
.checks {
  list-style: none;
  padding: 0;
}
.checks li {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: #fef2f2;
}
.checks li.allowed {
  background: #f0fdf4;
}
.checks .status {
  font-weight: 700;
}
.create {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.create input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
}
.posts {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.post {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.post-main {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.actions {
  display: flex;
  gap: 0.5rem;
}
button {
  padding: 0.4rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  background: #fff;
  cursor: pointer;
}
</style>
