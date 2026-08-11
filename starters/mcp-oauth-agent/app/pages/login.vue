<script setup lang="ts">
defineOptions({ name: 'McpLoginPage' })

const email = ref('')
const password = ref('')
const pending = ref(false)
const signInError = ref('')
const { errorMessage, loading, transaction } = useVerifiedOAuthTransaction()

async function signIn() {
  if (!transaction.value) return
  pending.value = true
  signInError.value = ''
  try {
    const response = await fetch('/api/auth/sign-in/email', {
      body: JSON.stringify({
        email: email.value.trim().toLowerCase(),
        oauth_query: transaction.value.signedQuery,
        password: password.value,
      }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const body = (await response.json()) as { redirect?: boolean; url?: string }
    if (!response.ok || !body.url) throw new Error('Sign in failed')
    window.location.assign(body.url)
  } catch {
    signInError.value = 'Sign in failed'
    pending.value = false
  }
}
</script>

<template>
  <main>
    <h1>Sign in to authorize MCP</h1>
    <p v-if="loading">Verifying authorization request…</p>
    <section v-else-if="transaction" aria-label="Verified authorization request">
      <p>
        <strong>{{ transaction.clientName }}</strong> is requesting access.
      </p>
      <p>
        Resource: <code>{{ transaction.resource }}</code>
      </p>
      <p>Scopes: {{ transaction.scopes.join(', ') }}</p>
    </section>
    <p v-else role="alert">{{ errorMessage }}</p>
    <form v-if="transaction" @submit.prevent="signIn">
      <label>Email <input v-model="email" data-testid="email" type="email" required /></label>
      <label
        >Password
        <input v-model="password" data-testid="password" type="password" required />
      </label>
      <p v-if="signInError" role="alert">{{ signInError }}</p>
      <button data-testid="sign-in" :disabled="pending || loading" type="submit">Sign in</button>
    </form>
  </main>
</template>
