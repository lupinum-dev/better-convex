import { isMcpScope } from '../../convex/mcp/scopes'

const MAX_SIGNED_QUERY_LENGTH = 16 * 1024

interface PublicOAuthClient {
  client_id?: unknown
  client_name?: unknown
}

export interface VerifiedOAuthTransaction {
  clientId: string
  clientName: string
  resource: string
  scopes: string[]
  signedQuery: string
}

function one(parameters: URLSearchParams, name: string): string {
  const values = parameters.getAll(name)
  if (values.length !== 1 || !values[0]) throw new Error('OAUTH_TRANSACTION_INVALID')
  return values[0]
}

export function useVerifiedOAuthTransaction() {
  const route = useRoute()
  const runtimeConfig = useRuntimeConfig()
  const transaction = ref<VerifiedOAuthTransaction | null>(null)
  const loading = ref(true)
  const errorMessage = ref('')

  onMounted(async () => {
    try {
      const queryIndex = route.fullPath.indexOf('?')
      const signedQuery = queryIndex === -1 ? '' : route.fullPath.slice(queryIndex + 1)
      if (!signedQuery || signedQuery.length > MAX_SIGNED_QUERY_LENGTH) {
        throw new Error('OAUTH_TRANSACTION_INVALID')
      }
      const parameters = new URLSearchParams(signedQuery)
      const clientId = one(parameters, 'client_id')
      const resource = one(parameters, 'resource')
      const scope = one(parameters, 'scope')
      const scopes = scope.split(' ')
      if (
        resource !== `${runtimeConfig.public.convex.siteUrl}/mcp` ||
        scopes.length === 0 ||
        new Set(scopes).size !== scopes.length ||
        scopes.some((entry) => !entry || !isMcpScope(entry))
      ) {
        throw new Error('OAUTH_TRANSACTION_INVALID')
      }

      const response = await fetch('/api/auth/oauth2/public-client-prelogin', {
        body: JSON.stringify({ client_id: clientId, oauth_query: signedQuery }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) throw new Error('OAUTH_TRANSACTION_INVALID')
      const client = (await response.json()) as PublicOAuthClient
      if (
        client.client_id !== clientId ||
        typeof client.client_name !== 'string' ||
        client.client_name.length === 0 ||
        client.client_name.length > 200
      ) {
        throw new Error('OAUTH_TRANSACTION_INVALID')
      }
      transaction.value = {
        clientId,
        clientName: client.client_name,
        resource,
        scopes,
        signedQuery,
      }
    } catch {
      errorMessage.value =
        'This authorization request is invalid or expired. Start again in the client.'
    } finally {
      loading.value = false
    }
  })

  return { errorMessage, loading, transaction }
}
