<script setup lang="ts">
const { user, status, isPending, error: authError, client } = useConvexAuth()
const route = useRoute()

async function handleSignOut() {
  try {
    if (!client) throw new Error('Authentication client unavailable')
    await client.signOut()
    window.location.href = '/'
  } catch (error) {
    console.error('Sign out failed:', error)
  }
}

const navSections = [
  {
    title: 'Demos',
    links: [
      { to: '/demo/dashboard', label: 'Dashboard', icon: '1' },
      { to: '/demo/tasks', label: 'Tasks', icon: '2' },
      { to: '/demo/permissions', label: 'Posts & Permissions', icon: '3' },
    ],
  },
  {
    title: 'Labs',
    links: [
      { to: '/labs/query', label: 'Query Testing', icon: 'Q' },
      { to: '/labs/pagination', label: 'Pagination', icon: 'P' },
      { to: '/labs/mutations', label: 'Mutations', icon: 'M' },
      { to: '/labs/realtime', label: 'Realtime', icon: 'R' },
      { to: '/labs/optimistic', label: 'Optimistic', icon: 'O' },
      { to: '/labs/auth', label: 'Auth State', icon: 'A' },
      { to: '/labs/connection', label: 'Connection State', icon: 'C' },
      { to: '/labs/upload', label: 'File Upload', icon: 'U' },
      { to: '/labs/server-actions', label: 'Server Actions', icon: 'S' },
    ],
  },
]

const isActiveRoute = (to: string) => {
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <div class="layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <NuxtLink to="/" class="logo">
          <span class="logo-icon">C</span>
          <span class="logo-text">Convexi</span>
        </NuxtLink>
      </div>

      <nav class="sidebar-nav">
        <div v-for="section in navSections" :key="section.title" class="nav-section">
          <h3 class="nav-title">{{ section.title }}</h3>
          <ul class="nav-list">
            <li v-for="link in section.links" :key="link.to">
              <NuxtLink :to="link.to" class="nav-item" :class="{ active: isActiveRoute(link.to) }">
                <span class="nav-icon">{{ link.icon }}</span>
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <div class="sidebar-footer">
        <NuxtLink to="/playground" class="nav-item">
          <span class="nav-icon">?</span>
          Interactive Docs
        </NuxtLink>
      </div>
    </aside>

    <!-- Main content -->
    <div class="main">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          <h1 class="page-title">{{ route.meta.title || 'Playground' }}</h1>
        </div>

        <div class="header-right">
          <span v-if="status === 'loading'" class="auth-user">Checking session...</span>
          <span v-else-if="status === 'error'" class="auth-user">
            {{ authError?.message ?? 'Authentication unavailable' }}
          </span>
          <template v-else-if="status === 'authenticated'">
            <span class="auth-user">{{ user?.name || user?.email }}</span>
            <button class="btn btn-sm" :disabled="isPending" @click="handleSignOut">
              {{ isPending ? 'Signing out...' : 'Sign Out' }}
            </button>
          </template>
          <template v-else-if="status === 'anonymous'">
            <NuxtLink to="/auth/signin" class="btn btn-sm btn-primary">Sign In</NuxtLink>
            <NuxtLink to="/auth/signup" class="btn btn-sm">Sign Up</NuxtLink>
          </template>
        </div>
      </header>

      <!-- Page content -->
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 240px;
  background: #1f2937;
  color: #e5e7eb;
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #374151;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}

.logo-icon {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: white;
}

.logo-text {
  font-size: 1.25rem;
  font-weight: 600;
  color: white;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}

.nav-section {
  margin-bottom: 24px;
}

.nav-title {
  padding: 0 20px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9ca3af;
  margin-bottom: 8px;
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  color: #d1d5db;
  text-decoration: none;
  font-size: 0.9rem;
  transition: all 0.15s;
}

.nav-item:hover {
  background: #374151;
  color: white;
}

.nav-item.active {
  background: #3b82f6;
  color: white;
}

.nav-icon {
  width: 24px;
  height: 24px;
  background: #374151;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
}

.nav-item.active .nav-icon {
  background: rgba(255, 255, 255, 0.2);
}

.sidebar-footer {
  padding: 16px 0;
  border-top: 1px solid #374151;
}

/* Main area */
.main {
  flex: 1;
  margin-left: 240px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  position: sticky;
  top: 0;
  z-index: 50;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: #1f2937;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auth-user {
  font-size: 0.9rem;
  color: #059669;
  font-weight: 500;
}

/* Content */
.content {
  flex: 1;
  padding: 24px;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  background: white;
  color: #374151;
  transition: all 0.15s;
}

.btn:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.btn-primary {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.btn-primary:hover {
  background: #2563eb;
  border-color: #2563eb;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.8rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
  }

  .main {
    margin-left: 0;
  }
}
</style>
