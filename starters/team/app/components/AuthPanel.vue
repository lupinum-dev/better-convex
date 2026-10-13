<script setup lang="ts">
import { sendCodeInputSchema, signInWithCodeInputSchema } from '~~/shared/inputSchemas'

const { message } = defineProps<{
  message: string
}>()

const { client } = useConvexAuth()
const busy = ref(false)

// Access here follows the invitation email, so people prove the address with a code
// (see `emailOTP` in convex/auth.ts). There is no password to register for someone else.
const codeSent = ref(false)
const name = ref('')
const email = ref('')
const otp = ref('')
const error = ref<string | null>(null)
const info = ref<string | null>(null)

const canSubmit = computed(() =>
  codeSent.value
    ? signInWithCodeInputSchema.safeParse({ name: name.value, email: email.value, otp: otp.value })
        .success
    : sendCodeInputSchema.safeParse({ email: email.value }).success,
)

const submitLabel = computed(() => {
  if (busy.value) return codeSent.value ? 'Signing in...' : 'Sending code...'
  return codeSent.value ? 'Sign in' : 'Send code'
})

async function submitAuth() {
  if (busy.value || !canSubmit.value) return

  error.value = null
  info.value = null

  busy.value = true
  try {
    if (!codeSent.value) {
      const parsed = sendCodeInputSchema.safeParse({ email: email.value })
      if (!parsed.success) {
        error.value = parsed.error.issues[0]?.message ?? 'Could not send the code'
        return
      }
      const result = await client.emailOtp.sendVerificationOtp({
        email: parsed.data.email,
        type: 'sign-in',
      })
      if (result.error) {
        error.value = 'The code could not be sent'
        return
      }
      codeSent.value = true
      info.value = 'Check your email for a six-digit code.'
      return
    }

    const parsed = signInWithCodeInputSchema.safeParse({
      name: name.value,
      email: email.value,
      otp: otp.value,
    })
    if (!parsed.success) {
      error.value = parsed.error.issues[0]?.message ?? 'Sign in failed'
      return
    }

    const result = await client.signIn.emailOtp(parsed.data)
    if (result.error) {
      error.value = 'Sign in could not be completed. Check the code and try again.'
      return
    }
    otp.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Authentication failed'
  } finally {
    busy.value = false
  }
}

function changeEmail() {
  codeSent.value = false
  otp.value = ''
  error.value = null
  info.value = null
}
</script>

<template>
  <section class="auth-panel">
    <strong>Signed out</strong>
    <span>{{ message }}</span>

    <form class="auth-form" @submit.prevent="submitAuth">
      <label>
        Name
        <input v-model="name" autocomplete="name" placeholder="Your name" required />
      </label>

      <label>
        Email
        <input
          v-model="email"
          autocomplete="email"
          :disabled="codeSent"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>

      <label v-if="codeSent">
        Code
        <input
          v-model="otp"
          autocomplete="one-time-code"
          inputmode="numeric"
          placeholder="Six-digit code"
          required
        />
      </label>

      <p v-if="info" class="auth-info">{{ info }}</p>
      <p v-if="error" class="auth-error">{{ error }}</p>

      <button type="submit" :disabled="busy || !canSubmit">
        {{ submitLabel }}
      </button>
      <button v-if="codeSent" type="button" class="link" @click="changeEmail">
        Use another email
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

.auth-form button {
  height: 36px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
}

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

.auth-form button.link {
  background: transparent;
  color: #475569;
  text-decoration: underline;
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
