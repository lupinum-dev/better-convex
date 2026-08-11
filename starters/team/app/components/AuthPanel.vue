<script setup lang="ts">
import {
  normalizeLocalCallbackURL,
  signInInputSchema,
  signUpInputSchema,
} from '~~/shared/inputSchemas'

const { message } = defineProps<{
  message: string
}>()

const { client, isPending } = useConvexAuth()
const route = useRoute()

const mode = ref<'signIn' | 'signUp'>('signUp')
const name = ref('')
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const info = ref<string | null>(null)
const signInFailure =
  'Sign in could not be completed. Check your credentials and verify your email if required.'
const callbackURL = computed(() => normalizeLocalCallbackURL(route.fullPath))

const canSubmit = computed(() => {
  const schema = mode.value === 'signIn' ? signInInputSchema : signUpInputSchema
  return schema.safeParse({
    name: name.value,
    email: email.value,
    password: password.value,
    callbackURL: callbackURL.value,
  }).success
})

const submitLabel = computed(() => {
  if (isPending.value) return mode.value === 'signIn' ? 'Signing in...' : 'Creating account...'
  return mode.value === 'signIn' ? 'Sign in' : 'Create account'
})
const passwordAutocomplete = computed(() =>
  mode.value === 'signIn' ? 'current-password' : 'new-password',
)

watch(mode, () => {
  error.value = null
  info.value = null
})

async function submitAuth() {
  if (isPending.value || !canSubmit.value) return

  error.value = null
  info.value = null

  try {
    if (!client) throw new Error('Authentication client unavailable')
    if (mode.value === 'signUp') {
      const parsed = signUpInputSchema.safeParse({
        name: name.value,
        email: email.value,
        password: password.value,
        callbackURL: callbackURL.value,
      })
      if (!parsed.success) {
        error.value = parsed.error.issues[0]?.message ?? 'Sign up failed'
        return
      }

      const { error: signUpError } = await client.signUp.email({
        ...parsed.data,
      })

      if (signUpError) {
        error.value = 'Sign up could not be completed'
        return
      }

      password.value = ''
      info.value = 'If the address can be registered, check your email for a verification link.'
      return
    }

    const parsed = signInInputSchema.safeParse({
      email: email.value,
      password: password.value,
      callbackURL: callbackURL.value,
    })
    if (!parsed.success) {
      error.value = parsed.error.issues[0]?.message ?? 'Sign in failed'
      return
    }

    const result = await client.signIn.email({
      ...parsed.data,
    })

    if (result.error) {
      error.value = signInFailure
      return
    }

    password.value = ''
    info.value =
      'Signed in. If your email is not verified yet, check your inbox for a verification link.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Authentication failed'
  }
}
</script>

<template>
  <section class="auth-panel">
    <strong>Signed out</strong>
    <span>{{ message }}</span>

    <div class="mode-toggle" aria-label="Authentication mode">
      <button type="button" :class="{ active: mode === 'signUp' }" @click="mode = 'signUp'">
        Sign up
      </button>
      <button type="button" :class="{ active: mode === 'signIn' }" @click="mode = 'signIn'">
        Sign in
      </button>
    </div>

    <form class="auth-form" @submit.prevent="submitAuth">
      <label v-if="mode === 'signUp'">
        Name
        <input v-model="name" autocomplete="name" placeholder="Your name" required />
      </label>

      <label>
        Email
        <input
          v-model="email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>

      <label>
        Password
        <input
          v-model="password"
          :autocomplete="passwordAutocomplete"
          minlength="15"
          placeholder="Min 15 characters"
          required
          type="password"
        />
      </label>

      <p v-if="info" class="auth-info">{{ info }}</p>
      <p v-if="error" class="auth-error">{{ error }}</p>

      <button type="submit" :disabled="isPending || !canSubmit">
        {{ submitLabel }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.auth-panel {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid #e4e7ec;
  border-radius: 8px;
  background: white;
  color: #475569;
}

.auth-panel strong {
  color: #18181b;
}

.mode-toggle {
  display: flex;
  width: fit-content;
  gap: 4px;
  padding: 4px;
  border: 1px solid #d6dae1;
  border-radius: 8px;
  background: #f7f8fb;
}

.mode-toggle button,
.auth-form button {
  height: 36px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
}

.mode-toggle button {
  padding: 0 12px;
  background: transparent;
  color: #475569;
}

.mode-toggle button.active,
.auth-form button {
  background: #18181b;
  color: white;
}

.auth-form {
  display: grid;
  gap: 10px;
  max-width: 360px;
}

.auth-form label {
  display: grid;
  gap: 6px;
  color: #334155;
  font-size: 14px;
}

.auth-form input {
  height: 38px;
  padding: 0 10px;
  border: 1px solid #d6dae1;
  border-radius: 6px;
  background: white;
  font: inherit;
}

.auth-form button {
  width: fit-content;
  padding: 0 14px;
}

.auth-form button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.auth-error {
  margin: 0;
}

.auth-info {
  margin: 0;
  color: #155eef;
}

.auth-error {
  color: #b42318;
}
</style>
