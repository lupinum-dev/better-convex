<script setup lang="ts">
definePageMeta({ convexAuth: 'guest' })

const { client } = useConvexAuth()
const returnTo = useConvexAuthReturnTo()

const email = ref('')
const code = ref('')
const codeSent = ref(false)
const busy = ref(false)
const message = ref<string | null>(null)

// Better Auth reports each failure with a code. Show a clear sentence for the common ones.
const messages: Record<string, string> = {
  INVALID_OTP: 'That code is not correct. Check it and try again.',
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Send a new one.',
}
function explain(error: { code?: string; message?: string }) {
  return (error.code && messages[error.code]) || error.message || 'Something went wrong.'
}

async function sendCode() {
  busy.value = true
  message.value = null
  const { error } = await client.emailOtp.sendVerificationOtp({
    email: email.value,
    type: 'sign-in',
  })
  busy.value = false
  if (error) {
    message.value = explain(error)
    return
  }
  codeSent.value = true
}

async function signIn() {
  busy.value = true
  message.value = null
  const { error } = await client.signIn.emailOtp({
    email: email.value,
    // A code copied from an email often has spaces around it.
    otp: code.value.trim(),
  })
  busy.value = false
  if (error) {
    message.value = explain(error)
    return
  }
  await navigateTo(returnTo.value ?? '/todos')
}
</script>

<template>
  <main>
    <h1>Sign in</h1>

    <form v-if="!codeSent" @submit.prevent="sendCode">
      <input
        v-model="email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        aria-label="Email"
        required
      />
      <button :disabled="busy">Send code</button>
    </form>

    <template v-else>
      <p class="muted">We sent a code to {{ email }}.</p>
      <form @submit.prevent="signIn">
        <input
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="123456"
          aria-label="Code"
          required
        />
        <button :disabled="busy">Sign in</button>
      </form>
      <button @click="codeSent = false">Use another email</button>
    </template>

    <p v-if="message" class="error">{{ message }}</p>
  </main>
</template>
