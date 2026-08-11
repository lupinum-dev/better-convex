import { resolve } from 'node:path'

export const MCP_FIXTURE_SCOPE = 'mcp:read mcp:write'
export const MCP_REMOTE_CALLBACK = 'http://127.0.0.1:3334/oauth/callback'
export const MCP_TOOL_NAMES = [
  'projects.list',
  'projects.create',
  'projects.delete.preview',
  'projects.delete.requestApproval',
  'projects.delete.execute',
]

export function normalizeEvidenceOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCP evidence origin must be an absolute origin')
  }
  const localHttp =
    url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('MCP evidence origin must use HTTPS, except for loopback fixtures')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MCP evidence origin must contain only scheme, host, and optional port')
  }
  return url.origin
}

const JWT_SHAPED_VALUE = /(?:^|[^\w-])eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{20,}(?=$|[^\w-])/u

export function buildMcpRemoteClientInfo(clientId) {
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('A provisioned MCP OAuth client ID is required')
  }
  return { client_id: clientId }
}

export function buildMcpRemoteClientMetadata() {
  return {
    redirect_uris: [MCP_REMOTE_CALLBACK],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: MCP_FIXTURE_SCOPE,
  }
}

export function buildMcpRemoteArgs(resource, infoPath, metadataPath) {
  return [
    'exec',
    'mcp-remote',
    resource,
    '3334',
    '--host',
    '127.0.0.1',
    '--transport',
    'http-only',
    '--resource',
    resource,
    '--auth-timeout',
    '60',
    '--static-oauth-client-info',
    `@${resolve(infoPath)}`,
    '--static-oauth-client-metadata',
    `@${resolve(metadataPath)}`,
  ]
}

export function redactEvidenceLog(value, secrets = []) {
  let output = value
  for (const secret of secrets) {
    if (secret) output = output.replaceAll(secret, '[REDACTED]')
  }
  return output.replace(/(https?:\/\/[^\s?]+)\?\S+/g, '$1?[REDACTED_QUERY]')
}

/** Captured client output is evidence, never an access-token transport. */
export function assertNoJwtShapedValue(value) {
  if (JWT_SHAPED_VALUE.test(String(value))) {
    throw new Error('Captured MCP client output contained a JWT-shaped value')
  }
}
