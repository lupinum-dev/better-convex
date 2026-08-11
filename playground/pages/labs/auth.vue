<template>
  <div class="container">
    <h1>Auth Lab</h1>
    <p class="description">
      This page tests explicit rendering from <code>useConvexAuth().status</code> and keeps
      operation progress in <code>isPending</code>.
    </p>

    <div class="current-state">
      <h2>Current Auth State</h2>
      <p class="hint">
        Authentication state comes from Better Auth. Product-specific profile fields belong in a
        typed Convex profile query instead of an augmented auth-user wrapper.
      </p>
      <p class="hint">
        <strong>Note:</strong> Better Auth owns identity, role, and org state. This playground does
        not enable the organization plugin, so the permission context below is signed-in only.
      </p>
      <div class="state-grid">
        <div class="state-item">
          <span class="label">status</span>
          <span class="value" :class="{ positive: status === 'authenticated' }">
            {{ status }}
          </span>
        </div>
        <div class="state-item">
          <span class="label">isPending</span>
          <span class="value" :class="{ active: isPending }">
            {{ isPending }}
          </span>
        </div>
        <div class="state-item">
          <span class="label">error</span>
          <span class="value">{{ authError?.message ?? '(none)' }}</span>
        </div>
        <div class="state-item">
          <span class="label">user</span>
          <span class="value">{{ user?.name || user?.email || '(none)' }}</span>
        </div>
        <div class="state-item">
          <span class="label">auth user id</span>
          <span class="value id">{{ user?.id || '(anonymous)' }}</span>
        </div>
        <div class="state-item">
          <span class="label">permission context userId</span>
          <span class="value id">{{ permissionUserId || '(not loaded)' }}</span>
        </div>
      </div>
    </div>

    <div class="component-demos">
      <h2>Status Rendering</h2>

      <div class="demo-card">
        <h3>status === 'loading'</h3>
        <p class="demo-description">Shows content only during initial auth resolution</p>
        <div class="demo-output">
          <div v-if="status === 'loading'" class="loading-indicator">
            <span class="spinner" />
            Checking authentication...
          </div>
          <span v-else class="not-shown">(Auth check complete - loading content hidden)</span>
        </div>
      </div>

      <div class="demo-card">
        <h3>status === 'authenticated'</h3>
        <p class="demo-description">Shows content only when user is authenticated</p>
        <div class="demo-output">
          <div v-if="status === 'authenticated'" class="auth-content authenticated">
            <span class="icon">&#x2714;</span>
            <div>
              <strong>Welcome, {{ user?.name || user?.email || 'User' }}!</strong>
              <p>You are authenticated and can access protected content.</p>
            </div>
          </div>
          <span v-else class="not-shown">(Not authenticated - content hidden)</span>
        </div>
      </div>

      <div class="demo-card">
        <h3>status === 'anonymous'</h3>
        <p class="demo-description">Shows content only when no user is authenticated</p>
        <div class="demo-output">
          <div v-if="status === 'anonymous'" class="auth-content unauthenticated">
            <span class="icon">&#x1F512;</span>
            <div>
              <strong>Please log in</strong>
              <p>You need to authenticate to access this feature.</p>
              <NuxtLink to="/auth/signin" class="login-link"> Go to Login &rarr; </NuxtLink>
            </div>
          </div>
          <span v-else class="not-shown">(Authenticated - unauthenticated content hidden)</span>
        </div>
      </div>
    </div>

    <div class="combined-example">
      <h2>Combined Example (Real-World Pattern)</h2>
      <div class="demo-output">
        <div v-if="status === 'loading'" class="loading-indicator">
          <span class="spinner" />
          Loading...
        </div>
        <div v-else-if="status === 'authenticated'" class="dashboard-preview">
          <h4>Dashboard</h4>
          <p>Your personalized content here.</p>
        </div>
        <div v-else-if="status === 'anonymous'" class="login-prompt">
          <h4>Welcome to the App</h4>
          <p>Please sign in to continue.</p>
        </div>
        <div v-else class="login-prompt">
          <h4>Authentication failed</h4>
          <p>{{ authError?.message ?? 'Reload the page to retry.' }}</p>
        </div>
      </div>
    </div>

    <div class="auth-actions">
      <h2>Test Authentication</h2>
      <div class="button-group">
        <NuxtLink v-if="status === 'anonymous'" to="/auth/signin" class="btn btn-primary">
          Log In
        </NuxtLink>
        <button
          v-else-if="status === 'authenticated'"
          class="btn btn-secondary"
          :disabled="isPending"
          @click="signOut"
        >
          {{ isPending ? 'Signing out...' : 'Sign Out' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

const { status, isPending, user, error: authError, client } = useConvexAuth()

const permissionQueryArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))
const { data: permissionContext } = await useConvexQuery(
  api.auth.getPermissionContext,
  permissionQueryArgs,
)

const permissionUserId = computed(() =>
  permissionContext.value && 'userId' in permissionContext.value
    ? permissionContext.value.userId
    : null,
)

async function signOut() {
  if (!client) throw new Error('Authentication client unavailable')
  await client.signOut()
}
</script>

<style scoped>
.container {
  max-width: 800px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 8px;
}

h2 {
  margin-top: 32px;
  margin-bottom: 16px;
  font-size: 1.3em;
  border-bottom: 2px solid #eee;
  padding-bottom: 8px;
}

.description {
  color: #666;
  margin-bottom: 24px;
}

.hint {
  margin: 0 0 12px 0;
  color: #555;
  font-size: 0.9em;
}

code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.current-state {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 8px;
}

.current-state h2 {
  margin-top: 0;
  border: none;
}

.state-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.state-item {
  background: white;
  padding: 12px;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.state-item .label {
  font-size: 0.85em;
  color: #666;
}

.state-item .value {
  font-weight: 600;
  font-family: monospace;
  overflow-wrap: anywhere;
}

.state-item .value.positive {
  color: #4caf50;
}
.state-item .value.active {
  color: #ff9800;
}
.state-item .value.id {
  font-size: 0.9em;
}

.status-text {
  margin: 12px 0 0;
  color: #444;
}

.role-buttons {
  flex-wrap: wrap;
}

.demo-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.demo-card h3 {
  margin: 0 0 4px 0;
  font-family: monospace;
  font-size: 1em;
  color: #1976d2;
}

.demo-description {
  margin: 0 0 12px 0;
  font-size: 0.9em;
  color: #666;
}

.demo-output {
  background: #fafafa;
  border: 1px dashed #ccc;
  border-radius: 6px;
  padding: 16px;
  min-height: 60px;
}

.not-shown {
  color: #999;
  font-style: italic;
  font-size: 0.9em;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #666;
}

.spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid #e0e0e0;
  border-top-color: #2196f3;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.auth-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
}

.auth-content.authenticated {
  background: #e8f5e9;
  border: 1px solid #c8e6c9;
}

.auth-content.unauthenticated {
  background: #fff3e0;
  border: 1px solid #ffe0b2;
}

.auth-content .icon {
  font-size: 1.5em;
}

.auth-content p {
  margin: 4px 0 8px 0;
  font-size: 0.9em;
  color: #666;
}

.login-link {
  color: #1976d2;
  text-decoration: none;
  font-size: 0.9em;
}

.login-link:hover {
  text-decoration: underline;
}

.combined-example .demo-output {
  background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
}

.dashboard-preview,
.login-prompt {
  text-align: center;
  padding: 20px;
}

.dashboard-preview {
  background: #e3f2fd;
  border-radius: 8px;
}

.login-prompt {
  background: #fff8e1;
  border-radius: 8px;
}

.dashboard-preview h4,
.login-prompt h4 {
  margin: 0 0 8px 0;
}

.dashboard-preview p,
.login-prompt p {
  margin: 0;
  color: #666;
}

.auth-actions {
  background: #f0f7ff;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
}

.auth-actions h2 {
  margin-top: 0;
  border: none;
}

.button-group {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn {
  display: inline-block;
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 1em;
  text-decoration: none;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: #2196f3;
  color: white;
}

.btn-primary:hover {
  background: #1976d2;
}

.btn-secondary {
  background: #757575;
  color: white;
}

.btn-secondary:hover {
  background: #616161;
}
</style>
