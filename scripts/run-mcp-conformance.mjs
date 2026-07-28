#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

import { normalizeEvidenceOrigin } from './mcp-auth-contracts.mjs'

export { normalizeEvidenceOrigin } from './mcp-auth-contracts.mjs'

export const MCP_PROTOCOL_VERSION = '2026-07-28'
export const MCP_EXPECTED_CAPABILITIES = Object.freeze(['tools'])

const MAX_RESPONSE_BYTES = 256 * 1024

async function readProtocolResponse(response) {
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new Error('MCP conformance response exceeded its bound')
  }
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error(`MCP conformance response was not JSON (${response.status})`)
  }
}

function requireProtocolError(evidence, status, code, description) {
  if (
    evidence.status !== status ||
    evidence.body?.error?.code !== code ||
    evidence.body?.result !== undefined
  ) {
    throw new Error(`MCP ${description} did not fail with ${status}/${code}`)
  }
}

function requireResultMetadata(result, description) {
  const serverInfo = result?._meta?.['io.modelcontextprotocol/serverInfo']
  if (
    result?.resultType !== 'complete' ||
    !serverInfo ||
    typeof serverInfo.name !== 'string' ||
    typeof serverInfo.version !== 'string'
  ) {
    throw new Error(`MCP ${description} omitted complete server identity metadata`)
  }
}

export async function runProtocolConformance({ bearer, endpoint, fetch = globalThis.fetch }) {
  if (typeof bearer !== 'string' || !bearer || bearer.length > 16_384) {
    throw new Error('MCP conformance bearer is invalid')
  }
  const resource = new URL(endpoint)
  if (resource.pathname !== '/mcp' || resource.search || resource.hash) {
    throw new Error('MCP conformance endpoint is invalid')
  }
  const exchanges = []
  const observedFetch = async (input, init) => {
    const request = new Request(input, init)
    const requestBody = JSON.parse(await request.clone().text())
    const response = await fetch(request)
    const responseBody = await readProtocolResponse(response.clone())
    exchanges.push({
      requestBody,
      requestHeaders: new Headers(request.headers),
      responseBody,
      responseHeaders: new Headers(response.headers),
      status: response.status,
    })
    return response
  }
  const transport = new StreamableHTTPClientTransport(resource, {
    fetch: observedFetch,
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
  })
  const client = new Client(
    { name: 'better-convex-conformance', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } },
  )
  try {
    await client.connect(transport)
    await client.listTools()
  } finally {
    await client.close().catch(() => {})
  }

  if (exchanges.length !== 2) {
    throw new Error(`MCP conformance observed ${exchanges.length} requests; expected 2`)
  }
  const [discover, tools] = exchanges
  if (
    discover.requestBody?.method !== 'server/discover' ||
    tools.requestBody?.method !== 'tools/list'
  ) {
    throw new Error('MCP conformance did not use stateless discovery and tool listing')
  }
  for (const [description, exchange] of [
    ['discovery', discover],
    ['tool listing', tools],
  ]) {
    if (
      exchange.status !== 200 ||
      exchange.requestHeaders.get('mcp-protocol-version') !== MCP_PROTOCOL_VERSION ||
      exchange.requestHeaders.get('mcp-method') !== exchange.requestBody.method ||
      exchange.requestHeaders.has('mcp-session-id') ||
      exchange.responseHeaders.has('mcp-session-id')
    ) {
      throw new Error(`MCP ${description} violated the stateless HTTP envelope`)
    }
    const meta = exchange.requestBody.params?._meta
    if (
      meta?.['io.modelcontextprotocol/protocolVersion'] !== MCP_PROTOCOL_VERSION ||
      !meta?.['io.modelcontextprotocol/clientCapabilities']
    ) {
      throw new Error(`MCP ${description} omitted required per-request metadata`)
    }
    const clientInfo = meta?.['io.modelcontextprotocol/clientInfo']
    if (clientInfo !== undefined && typeof clientInfo?.name !== 'string') {
      throw new Error(`MCP ${description} supplied invalid optional client identity metadata`)
    }
    requireResultMetadata(exchange.responseBody?.result, description)
  }

  const discoverResult = discover.responseBody.result
  const capabilities = Object.keys(discoverResult.capabilities ?? {}).sort()
  if (
    JSON.stringify(discoverResult.supportedVersions) !== JSON.stringify([MCP_PROTOCOL_VERSION]) ||
    JSON.stringify(capabilities) !== JSON.stringify(MCP_EXPECTED_CAPABILITIES) ||
    discoverResult.ttlMs !== 0 ||
    discoverResult.cacheScope !== 'private'
  ) {
    throw new Error('MCP discovery advertised an unsupported or cache-unsafe capability')
  }
  const toolsResult = tools.responseBody.result
  if (
    toolsResult.ttlMs !== 0 ||
    toolsResult.cacheScope !== 'private' ||
    !Array.isArray(toolsResult.tools) ||
    toolsResult.tools.length === 0 ||
    toolsResult.tools.some(
      (tool) =>
        tool?.inputSchema?.type !== 'object' ||
        tool.inputSchema.$schema !== 'https://json-schema.org/draft/2020-12/schema',
    )
  ) {
    throw new Error('MCP tool listing escaped the private zero-TTL schema profile')
  }

  const raw = async (body, headers) => {
    const response = await fetch(
      new Request(resource, {
        body: JSON.stringify(body),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'mcp-protocol-version': MCP_PROTOCOL_VERSION,
          ...headers,
        },
        method: 'POST',
      }),
    )
    const evidence = {
      body: await readProtocolResponse(response),
      status: response.status,
    }
    if (JSON.stringify(evidence).includes(bearer)) {
      throw new Error('MCP conformance response exposed its bearer')
    }
    return evidence
  }
  const withoutClientInfo = structuredClone(tools.requestBody)
  delete withoutClientInfo.params?._meta?.['io.modelcontextprotocol/clientInfo']
  const optionalClientInfo = await raw(withoutClientInfo, { 'mcp-method': 'tools/list' })
  if (
    optionalClientInfo.status !== 200 ||
    optionalClientInfo.body?.result?.resultType !== 'complete'
  ) {
    throw new Error('MCP server rejected a request without optional clientInfo metadata')
  }

  requireProtocolError(await raw(tools.requestBody, {}), 400, -32020, 'missing method header')
  requireProtocolError(
    await raw(tools.requestBody, { 'mcp-method': 'prompts/list' }),
    400,
    -32020,
    'method mismatch',
  )
  for (const [method, description] of [
    ['prompts/list', 'prompt operation'],
    ['resources/list', 'resource operation'],
    ['tasks/get', 'Tasks operation'],
  ]) {
    const unsupported = structuredClone(tools.requestBody)
    unsupported.method = method
    requireProtocolError(
      await raw(unsupported, { 'mcp-method': method }),
      404,
      -32601,
      `unadvertised ${description}`,
    )
  }
  const call = structuredClone(tools.requestBody)
  call.method = 'tools/call'
  call.params = {
    ...call.params,
    name: toolsResult.tools[0].name,
    arguments: {},
  }
  requireProtocolError(
    await raw(call, { 'mcp-method': 'tools/call', 'mcp-name': 'wrong-tool-name' }),
    400,
    -32020,
    'tool-name mismatch',
  )

  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    protocolVersion: MCP_PROTOCOL_VERSION,
    requests: exchanges.length,
    toolCount: toolsResult.tools.length,
  })
}

export async function runConformanceEvidence({ bearer, origin: originValue }) {
  if (!originValue || !bearer)
    throw new Error('MCP conformance evidence requires an origin and bearer')
  const origin = normalizeEvidenceOrigin(originValue)
  const upstream = `${origin}/mcp`

  const protocol = await runProtocolConformance({ bearer, endpoint: upstream })
  console.log(
    `MCP ${protocol.protocolVersion} stable-SDK contract check passed (${protocol.requests} stateless requests, ${protocol.toolCount} tools, capabilities: ${protocol.capabilities.join(', ')}).`,
  )
  console.log(
    `@modelcontextprotocol/conformance@0.1.16 has no ${MCP_PROTOCOL_VERSION} server scenarios; legacy protocol conformance is intentionally not relayed into the stateless server.`,
  )
}

export async function main() {
  const { runMcpEvidence } = await import('./run-mcp-auth.mjs')
  await runMcpEvidence({
    conformanceRunner: runConformanceEvidence,
    includeConformance: true,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
