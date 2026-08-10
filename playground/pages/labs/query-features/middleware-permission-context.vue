<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
  middleware: ['permission-context-query'],
})

const runMarker = useState<string>('labs:middleware-permission-context:last-run', () => '')
if (!runMarker.value) {
  runMarker.value = new Date().toISOString()
}

// Page-level query for debugging/visibility (middleware does the actual guard).
const {
  data: context,
  status,
  error,
} = await useConvexQuery(
  api.auth.getPermissionContext,
  {},
  {
    server: true,
  },
)
</script>

<template>
  <div data-testid="middleware-permission-context-page" class="page">
    <h1>Route Middleware + Permission Context</h1>
    <p class="description">
      This page is protected by a one-shot route guard: <code>useConvex().query()</code> handles
      client navigation and <code>serverConvex(event).query()</code> handles SSR. The page-level
      <code>useConvexQuery()</code> below is reactive display state, not guard orchestration.
    </p>

    <div class="card success">
      <strong>Middleware caller ran successfully.</strong>
      <p>
        You reached this page because the middleware was able to query Convex and got a non-null
        permission context.
      </p>
    </div>

    <div class="card">
      <h2>How To Verify</h2>
      <ol>
        <li>Sign in (if not signed in already).</li>
        <li>Open this page from the homepage link.</li>
        <li>Navigate to another page (for example <code>/labs/query</code>).</li>
        <li>Click back to this page and confirm it still loads (SPA navigation).</li>
        <li>Refresh this page directly and confirm it still loads (SSR).</li>
        <li>
          Open browser console and confirm you do not see the Vue <code>onUnmounted</code> warning.
        </li>
      </ol>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Query Status</h2>
        <p>
          <strong>Status:</strong> <code>{{ status }}</code>
        </p>
        <p v-if="error"><strong>Error:</strong> {{ error.message }}</p>
      </div>

      <div class="card">
        <h2>Last Page Render Marker</h2>
        <p class="mono">{{ runMarker }}</p>
        <p class="hint">
          This is just a page-side marker to help you see reload/navigation behavior while testing.
        </p>
      </div>
    </div>

    <div class="card">
      <h2>Permission Context (Debug)</h2>
      <pre data-testid="permission-context-json">{{ JSON.stringify(context, null, 2) }}</pre>
    </div>

    <div class="card">
      <h2>Admin-Only Middleware Variant (Example)</h2>
      <pre><code>export default defineNuxtRouteMiddleware(async () => {
  const context = import.meta.server
    ? await serverConvex(useRequestEvent()!).query(api.auth.getPermissionContext)
    : await useConvex().query(api.auth.getPermissionContext, {})

  if (!context || context.role !== 'admin') {
    return navigateTo('/')
  }
})</code></pre>
      <p class="hint">
        The playground middleware demo uses a non-null context check so new users can verify it
        works without setting up roles first.
      </p>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
  margin: 0 auto;
}

.description {
  color: #6b7280;
  margin-bottom: 16px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
}

.card h2 {
  margin: 0 0 8px;
  font-size: 1rem;
}

.card.success {
  border-color: #86efac;
  background: #f0fdf4;
}

.card.success p {
  margin: 6px 0 0;
}

ol {
  margin: 0;
  padding-left: 18px;
  line-height: 1.5;
}

pre {
  margin: 0;
  padding: 10px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.85rem;
}

code,
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.hint {
  color: #6b7280;
  font-size: 0.85rem;
  margin-top: 8px;
}
</style>
