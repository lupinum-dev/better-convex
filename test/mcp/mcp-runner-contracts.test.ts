import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  MCP_FIXTURE_SCOPE,
  MCP_REMOTE_CALLBACK,
  assertNoJwtShapedValue,
  buildMcpRemoteArgs,
  buildMcpRemoteClientInfo,
  buildMcpRemoteClientMetadata,
  redactEvidenceLog,
} from '../../scripts/mcp-auth-contracts.mjs'
import {
  MCP_EXPECTED_CAPABILITIES,
  MCP_PROTOCOL_VERSION,
  normalizeEvidenceOrigin,
  runProtocolConformance,
} from '../../scripts/run-mcp-conformance.mjs'

describe('pinned MCP client runner contracts', () => {
  it('uses the exact static mcp-remote public-client files and argv', () => {
    expect(buildMcpRemoteClientInfo('provider-generated-client-id')).toEqual({
      client_id: 'provider-generated-client-id',
    })
    expect(() => buildMcpRemoteClientInfo('')).toThrow(/client ID/)
    expect(buildMcpRemoteClientMetadata()).toEqual({
      redirect_uris: [MCP_REMOTE_CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: MCP_FIXTURE_SCOPE,
    })
    const args = buildMcpRemoteArgs(
      'https://app.example.test/mcp',
      '/tmp/info.json',
      '/tmp/metadata.json',
    )
    expect(args).toEqual([
      'exec',
      'mcp-remote',
      'https://app.example.test/mcp',
      '3334',
      '--host',
      '127.0.0.1',
      '--transport',
      'http-only',
      '--resource',
      'https://app.example.test/mcp',
      '--auth-timeout',
      '60',
      '--static-oauth-client-info',
      '@/tmp/info.json',
      '--static-oauth-client-metadata',
      '@/tmp/metadata.json',
    ])
    expect(args).not.toContain('--debug')
  })

  it('redacts exact secrets and URL query state before emitting child logs', () => {
    const output = redactEvidenceLog(
      'token-secret https://issuer.example/authorize?code=secret&state=secret',
      ['token-secret'],
    )
    expect(output).toBe('[REDACTED] https://issuer.example/authorize?[REDACTED_QUERY]')
    expect(output).not.toContain('secret')
  })

  it('fails closed when a captured client log contains a JWT-shaped value', () => {
    expect(() =>
      assertNoJwtShapedValue(
        'client log eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature-material-that-must-not-be-logged',
      ),
    ).toThrow(/JWT-shaped/)
    expect(() => assertNoJwtShapedValue('ordinary MCP client output')).not.toThrow()
  })
})

describe('official MCP conformance runner contracts', () => {
  it('proves the stable SDK stateless envelope and exact advertised capability surface', async () => {
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'bcn-conformance', version: '1.0.0' })
        server.registerTool(
          'search_notes',
          { inputSchema: z.object({ query: z.string().optional() }) },
          () => ({ content: [{ type: 'text', text: 'No notes matched.' }] }),
        )
        return server
      },
      { legacy: 'reject', responseMode: 'json' },
    )
    try {
      await expect(
        runProtocolConformance({
          bearer: 'conformance-bearer',
          endpoint: 'https://notes.example.test/mcp',
          fetch: (input: RequestInfo | URL, init?: RequestInit) =>
            handler.fetch(new Request(input, init)),
        }),
      ).resolves.toEqual({
        capabilities: MCP_EXPECTED_CAPABILITIES,
        protocolVersion: MCP_PROTOCOL_VERSION,
        requests: 2,
        toolCount: 1,
      })
    } finally {
      await handler.close()
    }
  })

  it('accepts only exact secure or loopback fixture origins', () => {
    expect(normalizeEvidenceOrigin('https://app.example.test')).toBe('https://app.example.test')
    expect(normalizeEvidenceOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(() => normalizeEvidenceOrigin('http://app.example.test')).toThrow(/HTTPS/)
    expect(() => normalizeEvidenceOrigin('https://app.example.test/path')).toThrow(/only scheme/)
  })
})
