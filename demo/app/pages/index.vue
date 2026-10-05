<script setup lang="ts">
const router = useRouter()
const { status, error: authError, client } = useConvexAuth()
const busy = ref(false)

const signInError = ref<string | null>(null)
const visibleError = computed(() => signInError.value ?? authError.value?.message ?? null)

// Redirect to demo if already authenticated
watch(
  status,
  (nextStatus) => {
    if (nextStatus === 'authenticated') {
      router.push('/demo')
    }
  },
  { immediate: true },
)

const providers = [
  {
    label: 'Continue with GitHub',
    icon: 'i-simple-icons-github',
    color: 'neutral' as const,
    onClick: async () => {
      if (busy.value) return
      signInError.value = null
      busy.value = true
      try {
        if (!client) throw new Error('Authentication client unavailable')
        await client.signIn.social({
          provider: 'github',
          callbackURL: '/demo',
        })
      } catch {
        signInError.value = 'Sign in could not be completed.'
      } finally {
        busy.value = false
      }
    },
  },
]
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UPageCard class="w-full max-w-sm">
      <UAuthForm
        title="Convex Demo"
        description="Sign in to explore real-time features"
        icon="i-lucide-flask-conical"
        :providers="providers"
        :loading="busy || status === 'pending'"
      >
        <UAlert v-if="visibleError" color="error" :description="visibleError" />
        <template #footer>
          <p class="text-xs text-muted">
            Your GitHub profile will be used for display purposes only.
          </p>
        </template>
      </UAuthForm>
    </UPageCard>
  </div>
</template>
