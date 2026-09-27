import type { Resource, Tool } from '@modelcontextprotocol/server'

// Import only through the root entry, so the build keeps one server owner in `dist/index.mjs`.
import {
  handleMcpRequest,
  type HandleMcpRequestOptions,
  type McpAccessContext,
  type McpAccessVerifier,
} from './index.js'

const protocolVersion = '2026-07-28'
const maximumPages = 100
const catalogBearer = 'mcp-catalog'

export interface ListMcpCatalogOptions<Principal = undefined> {
  readonly configureServer: HandleMcpRequestOptions<Principal>['configureServer']
  /** The access the listing runs as. `issuer` and `resource` must be valid MCP addresses. */
  readonly access: McpAccessContext
  readonly principal: Principal
  readonly serverInfo?: HandleMcpRequestOptions<Principal>['serverInfo']
  /** Pass the production values, so an unadvertised `requireScopes` scope fails here too. */
  readonly requiredScopes?: readonly string[]
  readonly scopesSupported?: readonly string[]
}

export interface McpCatalog {
  readonly tools: Tool[]
  readonly resources: Resource[]
}

/**
 * Lists the tools and resources a client sees for one principal. The listing runs through
 * `handleMcpRequest` with a verifier that accepts exactly `access` and `principal`, so names,
 * schemas, annotations and `_meta` match production. Use it for snapshot tests; tool and resource
 * callbacks are not invoked.
 */
export async function listMcpCatalog<Principal = undefined>(
  options: ListMcpCatalogOptions<Principal>,
): Promise<McpCatalog> {
  const verifier = {
    async verifyAccessToken() {
      return {
        access: options.access,
        principal: options.principal,
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
      }
    },
  } as McpAccessVerifier<Principal>
  const requestOptions: HandleMcpRequestOptions<Principal> = {
    resource: new URL(options.access.resource),
    serverInfo: options.serverInfo ?? { name: 'mcp-catalog', version: '0.0.0' },
    authorization: {
      mode: 'oauth',
      issuer: options.access.issuer,
      verifier,
      ...(options.requiredScopes === undefined ? {} : { requiredScopes: options.requiredScopes }),
      ...(options.scopesSupported === undefined
        ? {}
        : { scopesSupported: options.scopesSupported }),
    },
    configureServer: options.configureServer,
  }
  return {
    tools: (await listAll(requestOptions, 'tools/list', 'tools')) as Tool[],
    resources: (await listAll(requestOptions, 'resources/list', 'resources')) as Resource[],
  }
}

async function listAll<Principal>(
  options: HandleMcpRequestOptions<Principal>,
  method: 'tools/list' | 'resources/list',
  key: 'tools' | 'resources',
): Promise<unknown[]> {
  const items: unknown[] = []
  let cursor: string | undefined
  for (let page = 0; page < maximumPages; page += 1) {
    const response = await handleMcpRequest(
      new Request(options.resource, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${catalogBearer}`,
          'content-type': 'application/json',
          'mcp-method': method,
          'mcp-protocol-version': protocolVersion,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: page + 1,
          method,
          params: {
            ...(cursor === undefined ? {} : { cursor }),
            _meta: {
              'io.modelcontextprotocol/protocolVersion': protocolVersion,
              'io.modelcontextprotocol/clientInfo': { name: 'mcp-catalog', version: '0.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
      options,
    )
    let body: { result?: Record<string, unknown>; error?: { code: number; message: string } }
    try {
      body = await response.json()
    } catch {
      throw new Error(`MCP ${method} failed with HTTP ${response.status}`)
    }
    // A server without resources does not advertise the capability.
    if (body.error?.code === -32601 && page === 0) return items
    if (body.error || !body.result) {
      throw new Error(`MCP ${method} failed: ${body.error?.message ?? response.status}`)
    }
    items.push(...((body.result[key] as unknown[] | undefined) ?? []))
    cursor = typeof body.result.nextCursor === 'string' ? body.result.nextCursor : undefined
    if (cursor === undefined) return items
  }
  throw new Error(`MCP ${method} did not finish within ${maximumPages} pages`)
}
