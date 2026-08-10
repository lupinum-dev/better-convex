<script setup lang="ts">
const { user, status, isPending, error: authError, client } = useConvexAuth()
const { user: permissionUser } = await useDemoPermissions()
const router = useRouter()

// Get avatar URL from permission context (fetched from Convex, includes GitHub avatar)
const avatarUrl = computed(() => permissionUser.value?.avatarUrl)

async function signOut() {
  if (!client) throw new Error('Authentication client unavailable')
  await client.signOut()
  await router.push('/')
}

const items = computed(() => [
  [
    {
      label: user.value?.email || 'Unknown',
      slot: 'account',
      disabled: true,
    },
  ],
  [
    {
      label: 'Sign out',
      icon: 'i-lucide-log-out',
      onSelect: signOut,
    },
  ],
])
</script>

<template>
  <div v-if="status === 'loading'">
    <USkeleton class="w-8 h-8 rounded-full" />
  </div>

  <UDropdownMenu
    v-else-if="status === 'authenticated' && user"
    :items="items"
    :content="{ align: 'end' }"
  >
    <UButton color="neutral" variant="ghost" class="p-0.5" :loading="isPending">
      <UAvatar :src="avatarUrl" :alt="user.name || user.email || 'User'" size="sm" />
    </UButton>

    <template #account>
      <div class="flex items-center gap-2 px-1 py-1.5">
        <UAvatar :src="avatarUrl" :alt="user.name || user.email || 'User'" size="xs" />
        <div class="text-left">
          <p class="font-medium text-sm truncate">{{ user.name || 'User' }}</p>
          <p class="text-xs text-muted truncate">{{ user.email }}</p>
        </div>
      </div>
    </template>
  </UDropdownMenu>

  <UButton v-else-if="status === 'anonymous'" to="/auth/signin" color="primary" variant="soft">
    Sign in
  </UButton>

  <UButton
    v-else
    color="error"
    variant="soft"
    disabled
    :title="authError?.message ?? 'Authentication unavailable'"
  >
    Auth unavailable
  </UButton>
</template>
