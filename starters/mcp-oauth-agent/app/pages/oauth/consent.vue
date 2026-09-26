<script setup lang="ts">
import { MCP_SCOPES } from '../../../convex/scopes'

defineOptions({ name: 'McpConsentPage' })

function describeScope(scope: string): string {
  if (scope === 'offline_access') return 'Stay connected while your session in this app lasts.'
  return MCP_SCOPES[scope as keyof typeof MCP_SCOPES]
}

const pending = ref(false)
const consentError = ref('')
const { errorMessage, loading, transaction } = useVerifiedOAuthTransaction()

async function decide(accept: boolean) {
  if (!transaction.value) return
  pending.value = true
  consentError.value = ''
  try {
    const response = await fetch('/api/auth/oauth2/consent', {
      body: JSON.stringify({
        accept,
        oauth_query: transaction.value.signedQuery,
        scope: accept ? transaction.value.scopes.join(' ') : undefined,
      }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const body = (await response.json()) as { redirect?: boolean; url?: string }
    if (!response.ok || !body.url) throw new Error('Consent failed')
    window.location.assign(body.url)
  } catch {
    consentError.value = 'Consent could not be completed'
    pending.value = false
  }
}
</script>

<template>
  <main>
    <h1>Authorize MCP access</h1>
    <p v-if="loading">Verifying authorization request…</p>
    <section v-else-if="transaction" aria-label="Verified authorization request">
      <p>
        <strong>{{ transaction.clientName }}</strong> requests delegated access.
      </p>
      <p>
        Resource: <code>{{ transaction.resource }}</code>
      </p>
      <p>Scopes:</p>
      <ul>
        <li v-for="scope in transaction.scopes" :key="scope">
          <code>{{ scope }}</code
          >: {{ describeScope(scope) }}
        </li>
      </ul>
      <p>
        This applies to every organization you belong to, up to your role in each. Your membership
        and role are checked again for every tool call.
      </p>
    </section>
    <p v-else role="alert">{{ errorMessage }}</p>
    <p v-if="consentError" role="alert">{{ consentError }}</p>
    <button
      v-if="transaction"
      data-testid="deny-consent"
      :disabled="pending"
      type="button"
      @click="decide(false)"
    >
      Deny
    </button>
    <button
      v-if="transaction"
      data-testid="approve-consent"
      :disabled="pending"
      type="button"
      @click="decide(true)"
    >
      Approve
    </button>
  </main>
</template>
