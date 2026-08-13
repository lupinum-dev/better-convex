import type { oauthProvider } from '@better-auth/oauth-provider'
import type { AuthCtx } from '@lupinum/better-convex-nuxt/convex-auth'
import type { BetterAuthPlugin } from 'better-auth'
import {
  APIError,
  createAuthEndpoint,
  dispatchAuthEndpoint,
  getSessionFromCtx,
  sessionMiddleware,
} from 'better-auth/api'

import { internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { MCP_SCOPES } from './mcp/scopes'

interface PublicClientProfile {
  callback: string
  name: string
  profile: string
}

const CLIENTS = [
  {
    callback: 'http://localhost:6274/oauth/callback',
    name: 'MCP Inspector interoperability fixture',
    profile: 'bcn-inspector-fixture',
  },
  {
    callback: 'http://127.0.0.1:3334/oauth/callback',
    name: 'mcp-remote interoperability fixture',
    profile: 'bcn-mcp-remote-fixture',
  },
] as const satisfies readonly PublicClientProfile[]

const TERMINAL_CLIENTS = [
  {
    callback: CLIENTS[0].callback,
    name: 'MCP session-revocation evidence fixture',
    profile: 'bcn-mcp-session-revocation-fixture',
  },
  {
    callback: CLIENTS[0].callback,
    name: 'MCP client-disable evidence fixture',
    profile: 'bcn-mcp-client-disable-fixture',
  },
  {
    callback: CLIENTS[0].callback,
    name: 'MCP client-delete evidence fixture',
    profile: 'bcn-mcp-client-delete-fixture',
  },
  {
    callback: CLIENTS[0].callback,
    name: 'MCP consent-revocation evidence fixture',
    profile: 'bcn-mcp-consent-revocation-fixture',
  },
  {
    callback: CLIENTS[0].callback,
    name: 'MCP least-scope conformance evidence fixture',
    profile: 'bcn-mcp-conformance-fixture',
  },
] as const satisfies readonly PublicClientProfile[]

const CONFIDENTIAL_CLIENT = {
  callback: CLIENTS[0].callback,
  name: 'Confidential OAuth code security fixture',
  profile: 'bcn-confidential-code-fixture',
} as const

type ProviderPlugin = ReturnType<typeof oauthProvider>
type ProviderCall = (endpoint: unknown, input?: Record<string, unknown>) => Promise<unknown>

interface OAuthClientView {
  client_id?: unknown
  client_secret?: unknown
  client_name?: unknown
  disabled?: unknown
  dpop_bound_access_tokens?: unknown
  enable_end_session?: unknown
  grant_types?: unknown
  public?: unknown
  redirect_uris?: unknown
  require_pkce?: unknown
  response_types?: unknown
  scope?: unknown
  skip_consent?: unknown
  software_id?: unknown
  subject_type?: unknown
  token_endpoint_auth_method?: unknown
  type?: unknown
}

interface OAuthResourceView {
  accessTokenTtl?: unknown
  allowedScopes?: unknown
  disabled?: unknown
  dpopBoundAccessTokensRequired?: unknown
  identifier?: unknown
  name?: unknown
  signingAlgorithm?: unknown
}

interface OAuthConsentView {
  clientId?: unknown
  id?: unknown
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  )
}

function profileDrift(): never {
  throw new APIError('INTERNAL_SERVER_ERROR', {
    error: 'server_error',
    error_description: 'MCP_OAUTH_PROFILE_DRIFT',
  })
}

function assertClientProfile(
  value: OAuthClientView,
  expected: PublicClientProfile,
): asserts value is OAuthClientView & { client_id: string } {
  if (
    typeof value.client_id !== 'string' ||
    value.client_id.length === 0 ||
    value.client_id.length > 256 ||
    value.client_name !== expected.name ||
    value.software_id !== expected.profile ||
    value.disabled === true ||
    value.public !== true ||
    value.token_endpoint_auth_method !== 'none' ||
    value.type !== 'native' ||
    value.require_pkce !== true ||
    value.skip_consent !== false ||
    value.enable_end_session !== false ||
    value.dpop_bound_access_tokens !== false ||
    value.subject_type !== 'public' ||
    value.scope !== MCP_SCOPES.join(' ') ||
    !exactStrings(value.redirect_uris, [expected.callback]) ||
    !exactStrings(value.grant_types, ['authorization_code']) ||
    !exactStrings(value.response_types, ['code'])
  ) {
    profileDrift()
  }
}

function assertConfidentialClientProfile(
  value: OAuthClientView,
): asserts value is OAuthClientView & { client_id: string } {
  if (
    typeof value.client_id !== 'string' ||
    value.client_id.length === 0 ||
    value.client_id.length > 256 ||
    value.client_name !== CONFIDENTIAL_CLIENT.name ||
    value.software_id !== CONFIDENTIAL_CLIENT.profile ||
    value.disabled === true ||
    value.public !== false ||
    value.token_endpoint_auth_method !== 'client_secret_basic' ||
    value.type !== 'web' ||
    value.require_pkce !== true ||
    value.skip_consent !== false ||
    value.enable_end_session !== false ||
    value.dpop_bound_access_tokens !== false ||
    value.subject_type !== 'public' ||
    value.scope !== MCP_SCOPES.join(' ') ||
    !exactStrings(value.redirect_uris, [CONFIDENTIAL_CLIENT.callback]) ||
    !exactStrings(value.grant_types, ['authorization_code']) ||
    !exactStrings(value.response_types, ['code'])
  ) {
    profileDrift()
  }
}

function requireClientSecret(value: OAuthClientView): string {
  if (
    typeof value.client_secret !== 'string' ||
    value.client_secret.length < 16 ||
    value.client_secret.length > 512 ||
    !/^[\x21-\x7E]+$/u.test(value.client_secret)
  ) {
    profileDrift()
  }
  return value.client_secret
}

function assertResourceProfile(value: OAuthResourceView, resource: string): void {
  if (
    value.identifier !== resource ||
    value.name !== 'Better Convex Nuxt MCP' ||
    value.accessTokenTtl !== 600 ||
    value.disabled !== false ||
    value.dpopBoundAccessTokensRequired !== false ||
    value.signingAlgorithm !== 'RS256' ||
    !exactStrings(value.allowedScopes, MCP_SCOPES)
  ) {
    profileDrift()
  }
}

async function ensureResource(
  call: ProviderCall,
  provider: ProviderPlugin,
  resource: string,
): Promise<void> {
  const resources = (await call(provider.endpoints.adminListOAuthResources)) as OAuthResourceView[]
  let storedResource = resources.find((candidate) => candidate.identifier === resource)
  if (!storedResource) {
    storedResource = (await call(provider.endpoints.adminCreateOAuthResource, {
      body: {
        accessTokenTtl: 600,
        allowedScopes: [...MCP_SCOPES],
        disabled: false,
        dpopBoundAccessTokensRequired: false,
        identifier: resource,
        name: 'Better Convex Nuxt MCP',
        signingAlgorithm: 'RS256',
      },
    })) as OAuthResourceView
  }
  assertResourceProfile(storedResource, resource)
}

async function ensurePublicClient(
  call: ProviderCall,
  provider: ProviderPlugin,
  existingClients: OAuthClientView[],
  expected: PublicClientProfile,
  resource: string,
): Promise<string> {
  const matches = existingClients.filter((candidate) => candidate.software_id === expected.profile)
  if (matches.length > 1) profileDrift()
  let client = matches[0]
  if (!client) {
    client = (await call(provider.endpoints.adminCreateOAuthClient, {
      body: {
        client_name: expected.name,
        dpop_bound_access_tokens: false,
        enable_end_session: false,
        grant_types: ['authorization_code'],
        redirect_uris: [expected.callback],
        require_pkce: true,
        response_types: ['code'],
        scope: MCP_SCOPES.join(' '),
        skip_consent: false,
        software_id: expected.profile,
        subject_type: 'public',
        token_endpoint_auth_method: 'none',
        type: 'native',
      },
    })) as OAuthClientView
  }
  assertClientProfile(client, expected)
  await call(provider.endpoints.adminLinkClientResource, {
    params: { client_id: client.client_id, identifier: resource },
  })
  return client.client_id
}

async function provisionConfidentialClient(
  call: ProviderCall,
  provider: ProviderPlugin,
  resource: string,
): Promise<{ id: string; secret: string }> {
  const existingClients = ((await call(provider.endpoints.getOAuthClients)) ??
    []) as OAuthClientView[]
  const matches = existingClients.filter(
    (candidate) => candidate.software_id === CONFIDENTIAL_CLIENT.profile,
  )
  if (matches.length > 1) profileDrift()
  let client = matches[0]
  let secretView: OAuthClientView
  if (client) {
    assertConfidentialClientProfile(client)
    secretView = (await call(provider.endpoints.rotateClientSecret, {
      body: { client_id: client.client_id },
    })) as OAuthClientView
    if (secretView.client_id !== client.client_id) profileDrift()
  } else {
    client = (await call(provider.endpoints.adminCreateOAuthClient, {
      body: {
        client_name: CONFIDENTIAL_CLIENT.name,
        dpop_bound_access_tokens: false,
        enable_end_session: false,
        grant_types: ['authorization_code'],
        redirect_uris: [CONFIDENTIAL_CLIENT.callback],
        require_pkce: true,
        response_types: ['code'],
        scope: MCP_SCOPES.join(' '),
        skip_consent: false,
        software_id: CONFIDENTIAL_CLIENT.profile,
        subject_type: 'public',
        token_endpoint_auth_method: 'client_secret_basic',
        type: 'web',
      },
    })) as OAuthClientView
    assertConfidentialClientProfile(client)
    secretView = client
  }
  await call(provider.endpoints.adminLinkClientResource, {
    params: { client_id: client.client_id, identifier: resource },
  })
  return { id: client.client_id, secret: requireClientSecret(secretView) }
}

async function requireFixtureClient(
  call: ProviderCall,
  provider: ProviderPlugin,
  expected: PublicClientProfile,
): Promise<OAuthClientView & { client_id: string }> {
  const existingClients = ((await call(provider.endpoints.getOAuthClients)) ??
    []) as OAuthClientView[]
  const matches = existingClients.filter((candidate) => candidate.software_id === expected.profile)
  if (matches.length !== 1) profileDrift()
  const client = matches[0]
  if (!client) profileDrift()
  assertClientProfile(client, expected)
  return client
}

export function mcpOAuthAdminPlugin(
  authCtx: AuthCtx<DataModel>,
  provider: ProviderPlugin,
  origin: string,
): BetterAuthPlugin {
  const resource = `${origin}/mcp`

  const providerCall =
    (context: unknown, headers: Headers | undefined): ProviderCall =>
    async (endpoint, input = {}) => {
      const configuredMethod = (endpoint as { options?: { method?: unknown } }).options?.method
      const method = Array.isArray(configuredMethod) ? configuredMethod[0] : configuredMethod
      if (typeof method !== 'string' || method === '*') profileDrift()
      return await dispatchAuthEndpoint(
        endpoint as never,
        {
          ...input,
          asResponse: false,
          context,
          headers: headers ?? new Headers(),
          method,
        } as never,
      )
    }

  return {
    id: 'mcp-oauth-admin',
    endpoints: {
      provisionMcpInteropProfile: createAuthEndpoint(
        '/mcp/admin/provision',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const call = providerCall(ctx.context, ctx.headers)

          const session = await getSessionFromCtx(ctx)
          if (!session) throw new APIError('UNAUTHORIZED')
          await ensureResource(call, provider, resource)

          const existingClients = ((await call(provider.endpoints.getOAuthClients)) ??
            []) as OAuthClientView[]
          const clientIds: string[] = []
          for (const expected of CLIENTS) {
            clientIds.push(
              await ensurePublicClient(call, provider, existingClients, expected, resource),
            )
          }

          if (new Set(clientIds).size !== CLIENTS.length) profileDrift()

          if (!('runMutation' in authCtx) || typeof authCtx.runMutation !== 'function') {
            throw new APIError('INTERNAL_SERVER_ERROR')
          }
          const delegation = await authCtx.runMutation(internal.mcpAdmin.grantFixtureDelegations, {
            authUserId: session.user.id,
            clientIds,
          })

          if (
            !delegation ||
            typeof delegation !== 'object' ||
            !('organizationId' in delegation) ||
            typeof delegation.organizationId !== 'string'
          ) {
            profileDrift()
          }

          return ctx.json({
            clients: { inspector: clientIds[0], mcpRemote: clientIds[1] },
            organizationId: delegation.organizationId,
            resource,
          })
        },
      ),
      provisionMcpTerminalEvidence: createAuthEndpoint(
        '/mcp/admin/provision-terminal-evidence',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          if (!session) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          await ensureResource(call, provider, resource)
          const existingClients = ((await call(provider.endpoints.getOAuthClients)) ??
            []) as OAuthClientView[]
          const inspector = await ensurePublicClient(
            call,
            provider,
            existingClients,
            CLIENTS[0],
            resource,
          )
          const terminalIds: string[] = []
          for (const expected of TERMINAL_CLIENTS) {
            terminalIds.push(
              await ensurePublicClient(call, provider, existingClients, expected, resource),
            )
          }
          if (new Set([inspector, ...terminalIds]).size !== TERMINAL_CLIENTS.length + 1) {
            profileDrift()
          }
          if (!('runMutation' in authCtx) || typeof authCtx.runMutation !== 'function') {
            throw new APIError('INTERNAL_SERVER_ERROR')
          }
          const delegation = await authCtx.runMutation(internal.mcpAdmin.grantFixtureDelegations, {
            authUserId: session.user.id,
            clientIds: [inspector, ...terminalIds],
          })
          if (
            !delegation ||
            typeof delegation !== 'object' ||
            !('organizationId' in delegation) ||
            typeof delegation.organizationId !== 'string'
          ) {
            profileDrift()
          }
          return ctx.json({
            clients: {
              clientDelete: terminalIds[2],
              clientDisable: terminalIds[1],
              conformance: terminalIds[4],
              consentDelete: terminalIds[3],
              sessionDelete: terminalIds[0],
            },
            organizationId: delegation.organizationId,
            resource,
          })
        },
      ),
      disableMcpClientFixture: createAuthEndpoint(
        '/mcp/admin/disable-client-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          const client = await requireFixtureClient(call, provider, TERMINAL_CLIENTS[1])
          const updated = (await ctx.context.adapter.update({
            model: 'oauthClient',
            update: { disabled: true, updatedAt: new Date() },
            where: [{ field: 'clientId', value: client.client_id }],
          })) as { disabled?: unknown } | null
          if (updated?.disabled !== true) profileDrift()
          return ctx.json({ disabled: true })
        },
      ),
      deleteMcpClientFixture: createAuthEndpoint(
        '/mcp/admin/delete-client-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          const client = await requireFixtureClient(call, provider, TERMINAL_CLIENTS[2])
          await call(provider.endpoints.deleteOAuthClient, {
            body: { client_id: client.client_id },
          })
          return ctx.json({ deleted: true })
        },
      ),
      deleteMcpConsentFixture: createAuthEndpoint(
        '/mcp/admin/delete-consent-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          const client = await requireFixtureClient(call, provider, TERMINAL_CLIENTS[3])
          const consents = ((await call(provider.endpoints.getOAuthConsents)) ??
            []) as OAuthConsentView[]
          const matches = consents.filter((consent) => consent.clientId === client.client_id)
          if (
            matches.length !== 1 ||
            typeof matches[0]?.id !== 'string' ||
            matches[0].id.length === 0
          ) {
            profileDrift()
          }
          await call(provider.endpoints.deleteOAuthConsent, {
            body: { id: matches[0].id },
          })
          return ctx.json({ deleted: true })
        },
      ),
      disableMcpResourceFixture: createAuthEndpoint(
        '/mcp/admin/disable-resource-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          await call(provider.endpoints.adminUpdateOAuthResource, {
            body: { disabled: true },
            params: { identifier: resource },
          })
          return ctx.json({ disabled: true })
        },
      ),
      enableMcpResourceFixture: createAuthEndpoint(
        '/mcp/admin/enable-resource-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          await call(provider.endpoints.adminUpdateOAuthResource, {
            body: { disabled: false },
            params: { identifier: resource },
          })
          return ctx.json({ disabled: false })
        },
      ),
      unlinkMcpInspectorResourceFixture: createAuthEndpoint(
        '/mcp/admin/unlink-inspector-resource-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          const client = await requireFixtureClient(call, provider, CLIENTS[0])
          await call(provider.endpoints.adminUnlinkClientResource, {
            params: { client_id: client.client_id, identifier: resource },
          })
          return ctx.json({ unlinked: true })
        },
      ),
      linkMcpInspectorResourceFixture: createAuthEndpoint(
        '/mcp/admin/link-inspector-resource-fixture',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!(await getSessionFromCtx(ctx))) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          const client = await requireFixtureClient(call, provider, CLIENTS[0])
          await call(provider.endpoints.adminLinkClientResource, {
            params: { client_id: client.client_id, identifier: resource },
          })
          return ctx.json({ linked: true })
        },
      ),
      provisionMcpConfidentialFixture: createAuthEndpoint(
        '/mcp/admin/provision-confidential',
        {
          method: 'POST',
          metadata: { noStore: true },
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          if (!session) throw new APIError('UNAUTHORIZED')
          const call = providerCall(ctx.context, ctx.headers)
          await ensureResource(call, provider, resource)
          const client = await provisionConfidentialClient(call, provider, resource)
          return ctx.json({ client, resource })
        },
      ),
    },
  }
}
