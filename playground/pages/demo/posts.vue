<template>
  <div class="container">
    <div class="card">
      <header class="header">
        <h1>Posts & Permissions</h1>
        <div class="header-actions">
          <NuxtLink to="/demo/dashboard" class="btn btn-secondary">Dashboard</NuxtLink>
          <NuxtLink to="/demo/permissions" class="btn btn-secondary">Permissions</NuxtLink>
        </div>
      </header>

      <p class="description">
        A blog post management system demonstrating role-based permissions. Create, edit, and
        publish posts with permission checks.
      </p>

      <!-- Loading state -->
      <div v-if="status === 'loading' || (pending && status === 'authenticated')" class="loading">
        Loading posts...
      </div>

      <div v-else-if="status === 'error'" class="not-auth">
        <p>{{ authError?.message ?? 'Authentication failed.' }}</p>
      </div>

      <!-- Not authenticated -->
      <div v-else-if="status === 'anonymous'" class="not-auth">
        <p>You need to sign in to manage posts.</p>
        <NuxtLink to="/auth/signin" class="btn btn-primary">Sign In</NuxtLink>
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

        <!-- Error display -->
        <div v-if="error" class="error-box">
          {{ error.message }}
        </div>

        <!-- Create post form -->
        <section class="section">
          <h2>Create New Post</h2>
          <form class="post-form" @submit.prevent="createPost">
            <div class="form-group">
              <label for="title">Title</label>
              <input
                id="title"
                v-model="newPost.title"
                type="text"
                placeholder="Enter post title"
                :disabled="isCreating"
                required
              />
            </div>
            <div class="form-group">
              <label for="content">Content</label>
              <textarea
                id="content"
                v-model="newPost.content"
                placeholder="Write your post content..."
                rows="4"
                :disabled="isCreating"
                required
              />
            </div>
            <button type="submit" class="btn btn-primary" :disabled="!canCreate || isCreating">
              {{ isCreating ? 'Creating...' : 'Create Post' }}
            </button>
          </form>
        </section>

        <!-- Posts list -->
        <section class="section">
          <h2>All Posts ({{ posts?.length ?? 0 }})</h2>

          <div v-if="!posts || posts.length === 0" class="empty">
            <p>No posts yet. Create one above!</p>
          </div>

          <div v-else class="posts-list">
            <article v-for="post in posts" :key="post._id" class="post-card" :class="post.status">
              <div class="post-header">
                <div class="post-title-row">
                  <h3>{{ post.title }}</h3>
                  <span class="status-badge" :class="post.status">{{ post.status }}</span>
                </div>
                <div class="post-meta">
                  <span class="meta-item"> Created: {{ formatDate(post.createdAt) }} </span>
                  <span v-if="post.publishedAt" class="meta-item">
                    Published: {{ formatDate(post.publishedAt) }}
                  </span>
                </div>
              </div>

              <div class="post-content">
                <p>{{ post.content }}</p>
              </div>

              <div class="post-actions">
                <button
                  v-if="canEdit(post)"
                  class="btn btn-sm btn-secondary"
                  :disabled="editingPostId === post._id"
                  @click="startEdit(post)"
                >
                  {{ editingPostId === post._id ? 'Editing...' : 'Edit' }}
                </button>
                <button
                  v-if="canPublish(post)"
                  class="btn btn-sm btn-primary"
                  :disabled="publishingPostId === post._id"
                  @click="publishPost(post._id)"
                >
                  {{ publishingPostId === post._id ? 'Publishing...' : 'Publish' }}
                </button>
                <button
                  v-if="canDelete(post)"
                  class="btn btn-sm btn-danger"
                  :disabled="deletingPostId === post._id"
                  @click="deletePost(post._id)"
                >
                  {{ deletingPostId === post._id ? 'Deleting...' : 'Delete' }}
                </button>
              </div>

              <!-- Edit form (inline) -->
              <form
                v-if="editingPostId === post._id"
                class="edit-form"
                @submit.prevent="saveEdit(post._id)"
              >
                <div class="form-group">
                  <label>Title</label>
                  <input v-model="editingPost.title" type="text" :disabled="isSaving" required />
                </div>
                <div class="form-group">
                  <label>Content</label>
                  <textarea v-model="editingPost.content" rows="4" :disabled="isSaving" required />
                </div>
                <div class="form-actions">
                  <button type="submit" class="btn btn-sm btn-primary" :disabled="isSaving">
                    {{ isSaving ? 'Saving...' : 'Save' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary"
                    :disabled="isSaving"
                    @click="cancelEdit"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </article>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '~/convex/_generated/dataModel'

definePageMeta({
  layout: 'sidebar',
})

const { status, user, error: authError } = useConvexAuth()
// Query posts with real-time updates
const queryArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))

const { data: posts, pending, error } = await useConvexQuery(api.posts.list, queryArgs)

// New post form
const newPost = ref({
  title: '',
  content: '',
})
const isCreating = ref(false)

// Edit state
const editingPostId = ref<Id<'posts'> | null>(null)
const editingPost = ref({
  title: '',
  content: '',
})
const isSaving = ref(false)

// Action states
const publishingPostId = ref<Id<'posts'> | null>(null)
const deletingPostId = ref<Id<'posts'> | null>(null)

// Permission checks (simplified - actual checks happen server-side)
const canCreate = computed(() => {
  // In a real app, you'd check permissions client-side too
  // For now, we'll let the server handle it
  return status.value === 'authenticated' && user.value
})

// Ownership model: only the owner may edit/publish/delete their own posts.
// (The playground has no org plugin, so there are no admin/owner roles.)
function canEdit(post: { ownerId: string; status: string }) {
  if (!user.value) return false
  return user.value.authId === post.ownerId
}

function canPublish(post: { ownerId: string; status: string }) {
  if (!user.value) return false
  return user.value.authId === post.ownerId && post.status === 'draft'
}

function canDelete(post: { ownerId: string }) {
  if (!user.value) return false
  return user.value.authId === post.ownerId
}

// useConvex() is client-only; the handle is used exclusively from browser
// event handlers, so capture it during client setup and guard SSR.
const convexHandle = import.meta.client ? useConvex() : null
function getConvexClient() {
  if (!convexHandle) {
    throw new Error('Convex client unavailable')
  }
  return convexHandle
}

// Create post
async function createPost() {
  if (!newPost.value.title.trim() || !newPost.value.content.trim()) return

  isCreating.value = true
  try {
    const client = getConvexClient()
    await client.mutation(api.posts.create, {
      title: newPost.value.title.trim(),
      content: newPost.value.content.trim(),
    })
    newPost.value = { title: '', content: '' }
  } catch (e) {
    console.error('Failed to create post:', e)
    alert(`Failed to create post: ${e instanceof Error ? e.message : 'Unknown error'}`)
  } finally {
    isCreating.value = false
  }
}

// Start editing
function startEdit(post: { _id: Id<'posts'>; title: string; content: string }) {
  editingPostId.value = post._id
  editingPost.value = {
    title: post.title,
    content: post.content,
  }
}

// Cancel editing
function cancelEdit() {
  editingPostId.value = null
  editingPost.value = { title: '', content: '' }
}

// Save edit
async function saveEdit(postId: Id<'posts'>) {
  if (!editingPost.value.title.trim() || !editingPost.value.content.trim()) return

  isSaving.value = true
  try {
    const client = getConvexClient()
    await client.mutation(api.posts.update, {
      id: postId,
      title: editingPost.value.title.trim(),
      content: editingPost.value.content.trim(),
    })
    cancelEdit()
  } catch (e) {
    console.error('Failed to update post:', e)
    alert(`Failed to update post: ${e instanceof Error ? e.message : 'Unknown error'}`)
  } finally {
    isSaving.value = false
  }
}

// Publish post
async function publishPost(postId: Id<'posts'>) {
  publishingPostId.value = postId
  try {
    const client = getConvexClient()
    await client.mutation(api.posts.publish, { id: postId })
  } catch (e) {
    console.error('Failed to publish post:', e)
    alert(`Failed to publish post: ${e instanceof Error ? e.message : 'Unknown error'}`)
  } finally {
    publishingPostId.value = null
  }
}

// Delete post
async function deletePost(postId: Id<'posts'>) {
  if (!confirm('Are you sure you want to delete this post?')) return

  deletingPostId.value = postId
  try {
    const client = getConvexClient()
    await client.mutation(api.posts.remove, { id: postId })
  } catch (e) {
    console.error('Failed to delete post:', e)
    alert(`Failed to delete post: ${e instanceof Error ? e.message : 'Unknown error'}`)
  } finally {
    deletingPostId.value = null
  }
}

// Format date
function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}
</script>

<style scoped>
.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header h1 {
  margin: 0;
  font-size: 2rem;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.description {
  color: #666;
  margin-bottom: 24px;
  line-height: 1.6;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #666;
}

.not-auth {
  text-align: center;
  padding: 40px;
  background: #fff3cd;
  color: #856404;
  border-radius: 8px;
}

.not-auth .btn {
  margin-top: 16px;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
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
  margin-bottom: 24px;
}

.section {
  margin-bottom: 32px;
}

.section h2 {
  font-size: 1.5rem;
  margin-bottom: 16px;
  color: #1f2937;
}

.post-form {
  background: #f9fafb;
  padding: 20px;
  border-radius: 8px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #374151;
  font-size: 0.9rem;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 16px;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.form-group textarea {
  resize: vertical;
}

.empty {
  text-align: center;
  padding: 40px;
  background: #f9fafb;
  border-radius: 8px;
  color: #6b7280;
}

.posts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.post-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  transition: all 0.2s;
}

.post-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.post-card.published {
  border-left: 4px solid #10b981;
}

.post-card.draft {
  border-left: 4px solid #f59e0b;
}

.post-card.archived {
  border-left: 4px solid #6b7280;
  opacity: 0.7;
}

.post-header {
  margin-bottom: 12px;
}

.post-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.post-title-row h3 {
  margin: 0;
  font-size: 1.25rem;
  color: #1f2937;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.draft {
  background: #fef3c7;
  color: #92400e;
}

.status-badge.published {
  background: #d1fae5;
  color: #065f46;
}

.status-badge.archived {
  background: #e5e7eb;
  color: #374151;
}

.post-meta {
  display: flex;
  gap: 16px;
  font-size: 0.85rem;
  color: #6b7280;
}

.meta-item {
  display: flex;
  align-items: center;
}

.post-content {
  margin-bottom: 16px;
  color: #374151;
  line-height: 1.6;
  white-space: pre-wrap;
}

.post-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.edit-form {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
  background: white;
  padding: 16px;
  border-radius: 6px;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  display: inline-block;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.btn-primary {
  background: #4f46e5;
  color: white;
  border-color: #4f46e5;
}

.btn-primary:hover:not(:disabled) {
  background: #4338ca;
}

.btn-secondary {
  background: white;
  color: #374151;
  border-color: #d1d5db;
}

.btn-secondary:hover:not(:disabled) {
  background: #f9fafb;
}

.btn-danger {
  background: #dc2626;
  color: white;
  border-color: #dc2626;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.85rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
