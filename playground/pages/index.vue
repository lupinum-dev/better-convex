<template>
  <div class="container">
    <header class="header">
      <h1>Convexi Playground</h1>
      <p class="subtitle">Nuxt + Convex + Better Auth</p>

      <!-- Auth Status -->
      <div class="auth-status">
        <span v-if="status === 'loading'" class="status">Checking session...</span>
        <span v-else-if="status === 'error'" class="status">
          {{ authError?.message ?? 'Authentication unavailable' }}
        </span>
        <template v-else-if="status === 'authenticated'">
          <span class="status authenticated">
            Logged in as <strong>{{ user?.name || user?.email }}</strong>
          </span>
          <button class="btn btn-sm" :disabled="pending" @click="handleSignOut">
            {{ pending ? 'Signing out...' : 'Sign Out' }}
          </button>
        </template>
        <template v-else-if="status === 'anonymous'">
          <span class="status">Not authenticated</span>
          <NuxtLink to="/auth/signin" class="btn btn-sm btn-primary"> Sign In </NuxtLink>
          <NuxtLink to="/auth/signup" class="btn btn-sm"> Sign Up </NuxtLink>
        </template>
      </div>
    </header>

    <div class="grid">
      <!-- Demo Apps -->
      <section class="section">
        <h2>Demo Apps</h2>
        <div class="links">
          <NuxtLink to="/demo/dashboard" class="link-card">
            <span class="icon">1</span>
            <div>
              <strong>Dashboard</strong>
              <p>User dashboard (auth required)</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/demo/tasks" class="link-card">
            <span class="icon">2</span>
            <div>
              <strong>Tasks</strong>
              <p>Task management (auth required)</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/demo/posts" class="link-card featured">
            <span class="icon">3</span>
            <div>
              <strong>Posts & Permissions</strong>
              <p>Role-based access control system</p>
            </div>
          </NuxtLink>
        </div>
      </section>

      <!-- Interactive Labs -->
      <section class="section">
        <h2>Interactive Labs</h2>
        <div class="links">
          <NuxtLink to="/labs/query" class="link-card new">
            <span class="icon">Q</span>
            <div>
              <strong>Query Lab</strong>
              <p>Test useConvexQuery options</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/labs/query-features/middleware-permission-context" class="link-card new">
            <span class="icon">G</span>
            <div>
              <strong>Middleware Caller Guard</strong>
              <p>One-shot client and SSR query callers</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/labs/pagination" class="link-card new">
            <span class="icon">P</span>
            <div>
              <strong>Pagination Lab</strong>
              <p>Test useConvexPaginatedQuery</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/labs/mutations" class="link-card new">
            <span class="icon">M</span>
            <div>
              <strong>Mutations Lab</strong>
              <p>Test useConvexMutation</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/labs/realtime" class="link-card new">
            <span class="icon">R</span>
            <div>
              <strong>Realtime Lab</strong>
              <p>Live subscription testing</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/labs/auth" class="link-card new">
            <span class="icon">A</span>
            <div>
              <strong>Auth State</strong>
              <p>Explicit auth status rendering</p>
            </div>
          </NuxtLink>
          <NuxtLink to="/labs/connection" class="link-card new">
            <span class="icon">C</span>
            <div>
              <strong>Connection State</strong>
              <p>useConvexConnectionState</p>
            </div>
          </NuxtLink>
        </div>
      </section>

      <!-- Labs (for E2E tests) -->
      <section class="section">
        <h2>Labs</h2>
        <details>
          <summary class="lab-toggle">Show lab pages</summary>
          <div class="links lab-links">
            <NuxtLink to="/labs/query" class="link-card-mini">Query Options</NuxtLink>
            <NuxtLink to="/labs/query-features/deep-reactive" class="link-card-mini"
              >Reactive Args</NuxtLink
            >
            <NuxtLink to="/labs/query-features/skip" class="link-card-mini">Skip Queries</NuxtLink>
            <NuxtLink to="/labs/query-features/error" class="link-card-mini"
              >Error Handling</NuxtLink
            >
            <NuxtLink to="/labs/query-features/refresh" class="link-card-mini"
              >Query Refresh</NuxtLink
            >
            <NuxtLink to="/labs/query-features/middleware-permission-context" class="link-card-mini"
              >Middleware Caller Guard</NuxtLink
            >
            <NuxtLink to="/labs/realtime" class="link-card-mini">Realtime</NuxtLink>
            <NuxtLink to="/labs/optimistic" class="link-card-mini">Optimistic</NuxtLink>
            <NuxtLink to="/labs/pagination" class="link-card-mini">Pagination</NuxtLink>
            <NuxtLink to="/labs/connection" class="link-card-mini">Connection</NuxtLink>
            <NuxtLink to="/labs/auth" class="link-card-mini">Auth State</NuxtLink>
            <NuxtLink to="/labs/mutations" class="link-card-mini">Mutations</NuxtLink>
            <NuxtLink to="/labs/upload" class="link-card-mini">File Upload</NuxtLink>
          </div>
        </details>
      </section>

      <!-- Resources -->
      <section class="section">
        <h2>Resources</h2>
        <div class="links">
          <NuxtLink to="/playground" class="link-card">
            <span class="icon">?</span>
            <div>
              <strong>Interactive Docs</strong>
              <p>Explore API with live examples</p>
            </div>
          </NuxtLink>
        </div>
      </section>
    </div>

    <!-- Debug info -->
    <details class="debug">
      <summary>Debug Info</summary>
      <pre>{{ debugInfo }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
const { user, status, pending, error: authError, client } = useConvexAuth()

const debugInfo = computed(() => ({
  status: status.value,
  pending: pending.value,
  error: authError.value?.message,
  user: user.value,
}))

async function handleSignOut() {
  try {
    if (!client) throw new Error('Authentication client unavailable')
    await client.signOut()
    window.location.href = '/'
  } catch (error) {
    console.error('Sign out failed:', error)
  }
}
</script>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 20px;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

.header {
  text-align: center;
  margin-bottom: 40px;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  color: #666;
  font-size: 1.1rem;
  margin-bottom: 20px;
}

.auth-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.status {
  font-size: 0.9rem;
  color: #666;
}

.status.authenticated {
  color: #059669;
}

.btn {
  display: inline-block;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  background: white;
  color: #374151;
  transition: all 0.2s;
}

.btn:hover {
  background: #f3f4f6;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.btn-primary:hover {
  background: #2563eb;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.85rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 24px;
}

.section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.section h2 {
  font-size: 1.1rem;
  margin: 0 0 16px 0;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.links {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.link-card:hover {
  background: #f3f4f6;
  border-color: #e5e7eb;
}

.link-card.featured {
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.link-card.featured:hover {
  background: #d1fae5;
}

.link-card.new {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.link-card.new:hover {
  background: #dbeafe;
}

.link-card .icon {
  font-size: 1.5rem;
  line-height: 1;
}

.link-card strong {
  display: block;
  color: #1f2937;
  margin-bottom: 2px;
}

.link-card p {
  margin: 0;
  font-size: 0.85rem;
  color: #6b7280;
}

.debug {
  margin-top: 40px;
  text-align: left;
  font-size: 0.8rem;
  background: white;
  border-radius: 8px;
  padding: 16px;
}

.debug summary {
  cursor: pointer;
  color: #666;
}

.debug pre {
  background: #f3f4f6;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin-top: 8px;
}

.lab-toggle {
  cursor: pointer;
  color: #6b7280;
  font-size: 0.9rem;
  padding: 8px 0;
}

.lab-links {
  flex-direction: row !important;
  flex-wrap: wrap;
  gap: 8px !important;
  margin-top: 12px;
}

.link-card-mini {
  display: inline-block;
  padding: 6px 12px;
  background: #f3f4f6;
  border-radius: 6px;
  text-decoration: none;
  color: #374151;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.link-card-mini:hover {
  background: #e5e7eb;
}

.link-card .icon {
  width: 32px;
  height: 32px;
  background: #f3f4f6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  color: #6b7280;
}

.link-card.new .icon {
  background: #dbeafe;
  color: #1e40af;
}

.link-card.featured .icon {
  background: #d1fae5;
  color: #065f46;
}
</style>
