<script setup lang="ts">
const route = useRoute()

const navigation = [
  {
    label: 'Demo',
    icon: 'i-lucide-flask-conical',
    children: [
      { label: 'Overview', to: '/demo', icon: 'i-lucide-layout-dashboard' },
      { label: 'Real-time Feed', to: '/demo/feed', icon: 'i-lucide-radio' },
      { label: 'Reactive Args', to: '/demo/reactive', icon: 'lucide:refresh-ccw' },
      { label: 'Optimistic Updates', to: '/demo/optimistic', icon: 'i-lucide-zap' },
      { label: 'Pagination', to: '/demo/pagination', icon: 'i-lucide-list' },
      { label: 'File Storage', to: '/demo/storage', icon: 'i-lucide-cloud-upload' },
      { label: 'Personal Tasks', to: '/demo/personal', icon: 'i-lucide-lock' },
    ],
  },
]

// Check if current route is in demo section
const isDemoRoute = computed(() => route.path.startsWith('/demo'))
const isLoginPage = computed(() => route.path === '/')
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Header (hidden on login page) -->
    <UHeader v-if="!isLoginPage" class="bg-eggshell dark:bg-neutral-950">
      <template #left>
        <NuxtLink to="/" class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <UIcon name="i-lucide-flask-conical" class="w-5 h-5 text-white" />
          </div>
          <span class="font-bold text-lg">Convex Demo</span>
        </NuxtLink>
      </template>

      <template #right>
        <UColorModeButton />
        <UserMenu v-if="isDemoRoute" />
        <UButton v-else to="/demo" color="primary" variant="soft"> Enter Demo </UButton>
      </template>
    </UHeader>

    <!-- Main content area -->
    <div class="flex-1 flex">
      <!-- Sidebar - only show in demo section -->
      <aside
        v-if="isDemoRoute && !isLoginPage"
        class="w-64 border-r border-default bg-eggshell dark:bg-neutral-950 hidden lg:block"
      >
        <div class="p-4 space-y-6">
          <!-- Navigation -->
          <nav class="space-y-1">
            <template v-for="group in navigation" :key="group.label">
              <div class="text-xs font-semibold text-muted uppercase tracking-wider px-3 py-2">
                {{ group.label }}
              </div>
              <NuxtLink
                v-for="item in group.children"
                :key="item.to"
                :to="item.to"
                class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                :class="[
                  route.path === item.to
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted hover:text-default hover:bg-elevated',
                ]"
              >
                <UIcon :name="item.icon" class="w-4 h-4" />
                {{ item.label }}
              </NuxtLink>
            </template>
          </nav>

          <!-- External Links -->
          <div class="space-y-1 border-t border-default pt-4">
            <a
              href="https://github.com/lupinum-dev/better-convex"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-muted hover:text-default hover:bg-elevated"
            >
              <UIcon name="i-simple-icons-github" class="w-4 h-4" />
              GitHub
            </a>
            <a
              href="https://better-convex-nuxt.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-muted hover:text-default hover:bg-elevated"
            >
              <UIcon name="i-lucide-book-open" class="w-4 h-4" />
              Docs
            </a>
          </div>

          <!-- Connection Status -->
          <ConnectionStatus />
        </div>
      </aside>

      <!-- Page content -->
      <main class="flex-1">
        <slot />
      </main>
    </div>

    <!-- Footer - hidden on login and demo pages -->
    <UFooter v-if="!isDemoRoute && !isLoginPage">
      <template #left>
        <p class="text-sm text-muted">Built with better-convex-nuxt</p>
      </template>
      <template #right>
        <UButton
          to="https://github.com/lupinum-dev/better-convex"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
        />
      </template>
    </UFooter>
  </div>
</template>
