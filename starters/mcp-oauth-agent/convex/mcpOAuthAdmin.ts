import { requireAuthOrigin } from '@lupinum/better-convex-nuxt/better-auth/server'
import { APIError } from 'better-auth/api'
import type { HttpRouter } from 'convex/server'

import { internal } from './_generated/api'
import type { ActionCtx } from './_generated/server'
import { auth } from './auth'
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
  callback: 'https://client.example.test/oauth/callback',
  name: 'Confidential OAuth code security fixture',
  profile: 'bcn-confidential-code-fixture',
} as const

/** Server-side OAuth provider admin APIs used by the fixture routes. */
type ProviderEndpoint =
  | 'adminCreateOAuthClient'
  | 'adminCreateOAuthResource'
  | 'adminLinkClientResource'
  | 'adminListOAuthResources'
  | 'adminUnlinkClientResource'
  | 'adminUpdateOAuthResource'
  | 'deleteOAuthClient'
  | 'deleteOAuthConsent'
  | 'getOAuthClients'
  | 'getOAuthConsents'
  | 'rotateClientSecret'
type ProviderCall = (
  endpoint: ProviderEndpoint,
  input?: { body?: Record<string, unknown>; params?: Record<string, string> },
) => Promise<unknown>

interface OAuthClientView {
  application_type?: unknown
  client_id?: unknown
  client_secret?: unknown
  client_name?: unknown
  disabled?: unknown
  dpop_bound_access_tokens?: unknown
  enable_end_session?: unknown
  grant_types?: unknown
  redirect_uris?: unknown
  require_pkce?: unknown
  response_types?: unknown
  scope?: unknown
  skip_consent?: unknown
  software_id?: unknown
  subject_type?: unknown
  token_endpoint_auth_method?: unknown
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
    value.token_endpoint_auth_method !== 'none' ||
    value.application_type !== 'native' ||
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
    value.token_endpoint_auth_method !== 'client_secret_basic' ||
    value.application_type !== 'web' ||
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

async function ensureResource(call: ProviderCall, resource: string): Promise<void> {
  const resources = (await call('adminListOAuthResources')) as OAuthResourceView[]
  let storedResource = resources.find((candidate) => candidate.identifier === resource)
  if (!storedResource) {
    storedResource = (await call('adminCreateOAuthResource', {
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
  existingClients: OAuthClientView[],
  expected: PublicClientProfile,
  resource: string,
): Promise<string> {
  const matches = existingClients.filter((candidate) => candidate.software_id === expected.profile)
  if (matches.length > 1) profileDrift()
  let client: OAuthClientView | undefined = matches[0]
  if (client && client.application_type !== 'native') {
    await call('deleteOAuthClient', {
      body: { client_id: client.client_id },
    })
    client = undefined
  }
  if (!client) {
    client = (await call('adminCreateOAuthClient', {
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
        application_type: 'native',
      },
    })) as OAuthClientView
  }
  assertClientProfile(client, expected)
  await call('adminLinkClientResource', {
    params: { client_id: client.client_id, identifier: resource },
  })
  return client.client_id
}

async function provisionConfidentialClient(
  call: ProviderCall,
  resource: string,
): Promise<{ id: string; secret: string }> {
  const existingClients = ((await call('getOAuthClients')) ?? []) as OAuthClientView[]
  const matches = existingClients.filter(
    (candidate) => candidate.software_id === CONFIDENTIAL_CLIENT.profile,
  )
  if (matches.length > 1) profileDrift()
  let client: OAuthClientView | undefined = matches[0]
  let secretView: OAuthClientView
  if (client && client.application_type !== 'web') {
    await call('deleteOAuthClient', {
      body: { client_id: client.client_id },
    })
    client = undefined
  }
  if (client) {
    assertConfidentialClientProfile(client)
    secretView = (await call('rotateClientSecret', {
      body: { client_id: client.client_id },
    })) as OAuthClientView
    if (secretView.client_id !== client.client_id) profileDrift()
  } else {
    client = (await call('adminCreateOAuthClient', {
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
        application_type: 'web',
      },
    })) as OAuthClientView
    assertConfidentialClientProfile(client)
    secretView = client
  }
  await call('adminLinkClientResource', {
    params: { client_id: client.client_id, identifier: resource },
  })
  return { id: client.client_id, secret: requireClientSecret(secretView) }
}

async function requireFixtureClient(
  call: ProviderCall,
  expected: PublicClientProfile,
): Promise<OAuthClientView & { client_id: string }> {
  const existingClients = ((await call('getOAuthClients')) ?? []) as OAuthClientView[]
  const matches = existingClients.filter((candidate) => candidate.software_id === expected.profile)
  if (matches.length !== 1) profileDrift()
  const client = matches[0]
  if (!client) profileDrift()
  assertClientProfile(client, expected)
  return client
}

interface FixtureAdapter {
  update(input: {
    model: string
    update: Record<string, unknown>
    where: Array<{ field: string; value: string }>
  }): Promise<unknown>
}

interface FixtureRequest {
  readonly adapter: FixtureAdapter
  readonly authUserId: string
  readonly call: ProviderCall
  readonly ctx: ActionCtx
  readonly resource: string
}

type FixtureOperation = (request: FixtureRequest) => Promise<Record<string, unknown>>

function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
    status,
  })
}

/**
 * One session-authenticated fixture route. `auth.sessionHttpAction` applies the
 * same hardening as `/api/auth/*` (signed client IP, Better Auth rate limiting,
 * same-origin check, session admission). The provider admin APIs then re-check
 * `clientPrivileges`/`resourcePrivileges`, so only a live projected OAuth
 * administrator can provision.
 */
function fixtureRoute(operation: FixtureOperation) {
  return auth.sessionHttpAction(async (ctx, session) => {
    const api = session.auth.api as unknown as Record<
      ProviderEndpoint,
      (input: Record<string, unknown>) => Promise<unknown>
    >
    const call: ProviderCall = async (endpoint, input = {}) =>
      await api[endpoint]({ ...input, headers: session.headers })
    const { adapter } = (await session.auth.$context) as { adapter: FixtureAdapter }
    try {
      return noStoreJson(
        await operation({
          adapter,
          authUserId: session.user.id,
          call,
          ctx,
          resource: `${requireAuthOrigin('CONVEX_SITE_URL')}/mcp`,
        }),
      )
    } catch (error) {
      if (error instanceof APIError) {
        return noStoreJson(error.body ?? { code: error.status }, error.statusCode)
      }
      throw error
    }
  })
}

async function grantFixtureDelegations(
  ctx: ActionCtx,
  authUserId: string,
  clientIds: string[],
): Promise<string> {
  const delegation = await ctx.runMutation(internal.mcpAdmin.grantFixtureDelegations, {
    authUserId,
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
  return delegation.organizationId
}

const fixtureOperations: Record<string, FixtureOperation> = {
  provision: async ({ authUserId, call, ctx, resource }) => {
    await ensureResource(call, resource)
    const existingClients = ((await call('getOAuthClients')) ?? []) as OAuthClientView[]
    const clientIds: string[] = []
    for (const expected of CLIENTS) {
      clientIds.push(await ensurePublicClient(call, existingClients, expected, resource))
    }
    if (new Set(clientIds).size !== CLIENTS.length) profileDrift()
    return {
      clients: { inspector: clientIds[0], mcpRemote: clientIds[1] },
      organizationId: await grantFixtureDelegations(ctx, authUserId, clientIds),
      resource,
    }
  },
  'provision-terminal-evidence': async ({ authUserId, call, ctx, resource }) => {
    await ensureResource(call, resource)
    const existingClients = ((await call('getOAuthClients')) ?? []) as OAuthClientView[]
    const inspector = await ensurePublicClient(call, existingClients, CLIENTS[0], resource)
    const terminalIds: string[] = []
    for (const expected of TERMINAL_CLIENTS) {
      terminalIds.push(await ensurePublicClient(call, existingClients, expected, resource))
    }
    if (new Set([inspector, ...terminalIds]).size !== TERMINAL_CLIENTS.length + 1) {
      profileDrift()
    }
    return {
      clients: {
        clientDelete: terminalIds[2],
        clientDisable: terminalIds[1],
        conformance: terminalIds[4],
        consentDelete: terminalIds[3],
        sessionDelete: terminalIds[0],
      },
      organizationId: await grantFixtureDelegations(ctx, authUserId, [inspector, ...terminalIds]),
      resource,
    }
  },
  'disable-client-fixture': async ({ adapter, call }) => {
    const client = await requireFixtureClient(call, TERMINAL_CLIENTS[1])
    const updated = (await adapter.update({
      model: 'oauthClient',
      update: { disabled: true, updatedAt: new Date() },
      where: [{ field: 'clientId', value: client.client_id }],
    })) as { disabled?: unknown } | null
    if (updated?.disabled !== true) profileDrift()
    return { disabled: true }
  },
  'delete-client-fixture': async ({ call }) => {
    const client = await requireFixtureClient(call, TERMINAL_CLIENTS[2])
    await call('deleteOAuthClient', { body: { client_id: client.client_id } })
    return { deleted: true }
  },
  'delete-consent-fixture': async ({ call }) => {
    const client = await requireFixtureClient(call, TERMINAL_CLIENTS[3])
    const consents = ((await call('getOAuthConsents')) ?? []) as OAuthConsentView[]
    const matches = consents.filter((consent) => consent.clientId === client.client_id)
    const consentId = matches[0]?.id
    if (matches.length !== 1 || typeof consentId !== 'string' || consentId.length === 0) {
      profileDrift()
    }
    await call('deleteOAuthConsent', { body: { id: consentId } })
    return { deleted: true }
  },
  'disable-resource-fixture': async ({ call, resource }) => {
    await call('adminUpdateOAuthResource', {
      body: { disabled: true },
      params: { identifier: resource },
    })
    return { disabled: true }
  },
  'enable-resource-fixture': async ({ call, resource }) => {
    await call('adminUpdateOAuthResource', {
      body: { disabled: false },
      params: { identifier: resource },
    })
    return { disabled: false }
  },
  'unlink-inspector-resource-fixture': async ({ call, resource }) => {
    const client = await requireFixtureClient(call, CLIENTS[0])
    await call('adminUnlinkClientResource', {
      params: { client_id: client.client_id, identifier: resource },
    })
    return { unlinked: true }
  },
  'link-inspector-resource-fixture': async ({ call, resource }) => {
    const client = await requireFixtureClient(call, CLIENTS[0])
    await call('adminLinkClientResource', {
      params: { client_id: client.client_id, identifier: resource },
    })
    return { linked: true }
  },
  'provision-confidential': async ({ call, resource }) => {
    await ensureResource(call, resource)
    const client = await provisionConfidentialClient(call, resource)
    return { client, resource }
  },
}

/**
 * Mount the local interoperability and evidence fixtures under the auth proxy
 * path. Exact Convex routes take precedence over the `/api/auth/` prefix.
 */
export function registerMcpOAuthFixtureRoutes(http: HttpRouter): void {
  for (const [name, operation] of Object.entries(fixtureOperations)) {
    http.route({
      handler: fixtureRoute(operation),
      method: 'POST',
      path: `/api/auth/mcp/admin/${name}`,
    })
  }
}
