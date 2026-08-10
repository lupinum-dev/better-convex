<template>
  <div class="container">
    <div class="card">
      <h1>Create Account</h1>
      <p class="subtitle">Sign up with your email and password</p>

      <form class="form" @submit.prevent="handleSignUp">
        <div class="field">
          <label for="name">Name</label>
          <input id="name" v-model="form.name" type="text" placeholder="Your name" required />
        </div>

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
            placeholder="Min 15 characters"
            minlength="15"
            required
          />
        </div>

        <div v-if="visibleError" class="error">
          {{ visibleError }}
        </div>

        <button type="submit" class="btn btn-primary" :disabled="isPending">
          {{ isPending ? 'Creating account...' : 'Create Account' }}
        </button>
      </form>

      <p class="footer">
        Already have an account?
        <NuxtLink to="/auth/signin">Sign in</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const { client, isPending, error: authError } = useConvexAuth()

const form = reactive({
  name: '',
  email: '',
  password: '',
})

const error = ref<string | null>(null)
const visibleError = computed(() => error.value ?? authError.value?.message ?? null)

async function handleSignUp() {
  if (isPending.value) return
  error.value = null

  try {
    if (!client) throw new Error('Authentication client unavailable')
    const result = await client.signUp.email({
      name: form.name,
      email: form.email,
      password: form.password,
    })

    if (result.error) {
      error.value = 'Sign up could not be completed'
      return
    }

    // Signup intentionally creates no session, avoiding the pinned default's
    // immediate duplicate status/token disclosure. Continue through sign-in;
    // the broader enumeration limitation remains documented in SECURITY.md.
    await navigateTo('/auth/signin')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'An unexpected error occurred'
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
