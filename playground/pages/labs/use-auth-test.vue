<template>
  <div class="container">
    <h1>useConvexAuth Test</h1>

    <div class="panel">
      <div class="row">
        <span>status</span><strong data-testid="auth-state">{{ status }}</strong>
      </div>
      <div class="row">
        <span>pending</span><strong>{{ pending }}</strong>
      </div>
      <ClientOnly>
        <div class="row">
          <span>hasClient</span><strong>{{ client ? 'yes' : 'no' }}</strong>
        </div>
      </ClientOnly>
      <div class="row">
        <span>signIn.email type</span><strong>{{ signInEmailType }}</strong>
      </div>
      <div class="row">
        <span>signUp.email type</span><strong>{{ signUpEmailType }}</strong>
      </div>
      <div class="row">
        <span>user email</span><strong data-testid="auth-email">{{ user?.email || 'none' }}</strong>
      </div>
      <ClientOnly>
        <div class="row">
          <span>public session user id</span>
          <strong data-testid="session-user-id">{{ publicSessionUserId || 'none' }}</strong>
        </div>
      </ClientOnly>
      <div class="row">
        <span>Convex ctx.auth subject</span>
        <strong data-testid="convex-auth-subject">{{ permissionContext?.userId || 'none' }}</strong>
      </div>
    </div>

    <div class="panel actions">
      <button class="btn" :disabled="pending" @click="callSignIn">Call signIn.email()</button>
      <button class="btn" :disabled="pending" @click="callSignUp">Call signUp.email()</button>
      <button class="btn" data-testid="integrated-signout" :disabled="pending" @click="callSignOut">
        Integrated Better Auth signOut()
      </button>
      <pre class="result">{{ resultText }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '#convex/api'

definePageMeta({
  layout: 'sidebar',
})

const { status, pending, user, client } = useConvexAuth()
const publicSession = client?.useSession()
const publicSessionUserId = computed(() => publicSession?.value.data?.user.id ?? null)
const permissionArgs = computed(() => (status.value === 'authenticated' ? {} : 'skip'))
const { data: permissionContext } = await useConvexQuery(
  api.auth.getPermissionContext,
  permissionArgs,
)
const resultText = ref('(idle)')

const signInEmailType = computed(() => typeof client?.signIn.email)
const signUpEmailType = computed(() => typeof client?.signUp.email)

function requireAuthClient() {
  if (!client) throw new Error('Authentication client unavailable')
  return client
}

async function callSignIn() {
  const result = await requireAuthClient().signIn.email({
    email: 'stub@example.com',
    password: 'Password123456!',
  })
  resultText.value = JSON.stringify(result, null, 2)
}

async function callSignUp() {
  const result = await requireAuthClient().signUp.email({
    name: 'Stub User',
    email: 'stub@example.com',
    password: 'Password123456!',
  })
  resultText.value = JSON.stringify(result, null, 2)
}

async function callSignOut() {
  resultText.value = JSON.stringify(await requireAuthClient().signOut(), null, 2)
}
</script>

<style scoped>
.container {
  max-width: 720px;
  margin: 0 auto;
}

.panel {
  background: #f6f7f9;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-family: monospace;
}

.actions {
  display: grid;
  gap: 10px;
}

.btn {
  border: none;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  width: fit-content;
}

.result {
  margin: 0;
  background: #111827;
  color: #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  min-height: 80px;
  overflow: auto;
  font-size: 12px;
}
</style>
