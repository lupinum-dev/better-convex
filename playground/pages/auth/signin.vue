<template>
  <div class="container">
    <div class="card">
      <h1>Welcome Back</h1>
      <p class="subtitle">Sign in to your account</p>

      <form class="form" @submit.prevent="handleSignIn">
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            placeholder="you@example.com"
            required
          />
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            placeholder="Your password"
            required
          />
        </div>

        <div v-if="visibleError" class="error">
          {{ visibleError }}
        </div>

        <button type="submit" class="btn btn-primary" :disabled="pending">
          {{ pending ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>

      <p class="footer">
        Don't have an account?
        <NuxtLink to="/auth/signup">Create one</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const { client, pending, error: authError } = useConvexAuth()

const form = reactive({
  email: '',
  password: '',
})

const error = ref<string | null>(null)
const visibleError = computed(() => error.value ?? authError.value?.message ?? null)
const signInFailure =
  'Sign in could not be completed. Check your credentials and verify your email if required.'

async function handleSignIn() {
  if (pending.value) return
  error.value = null

  try {
    if (!client) throw new Error('Authentication client unavailable')
    const result = await client.signIn.email({
      email: form.email,
      password: form.password,
    })

    if (result.error) {
      error.value = signInFailure
      return
    }

    // The integrated client settles the resulting Convex identity before the
    // Promise resolves, so navigation cannot race authentication.
    window.location.href = '/'
  } catch {
    error.value = signInFailure
  }
}
</script>

<style scoped>
.container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 40px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

h1 {
  font-size: 1.5rem;
  margin-bottom: 8px;
  text-align: center;
}

.subtitle {
  color: #666;
  margin-bottom: 24px;
  text-align: center;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

label {
  font-size: 0.9rem;
  font-weight: 500;
  color: #374151;
}

input {
  padding: 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.2s;
}

input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.error {
  background: #fef2f2;
  color: #dc2626;
  padding: 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.btn {
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.footer {
  margin-top: 24px;
  text-align: center;
  color: #666;
  font-size: 0.9rem;
}

.footer a {
  color: #3b82f6;
  text-decoration: none;
}

.footer a:hover {
  text-decoration: underline;
}
</style>
