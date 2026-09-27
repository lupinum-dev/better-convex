import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const sdk = '@modelcontextprotocol/server'

describe('@lupinum/better-convex-mcp SDK ownership', () => {
  it('declares the official server SDK as an exact peer, never as its own dependency', () => {
    // `McpServer` crosses the public API (configureServer, defineMcpTool), so a
    // second nested SDK copy would break instanceof and protocol-version checks.
    const mcp = read('packages/mcp/package.json')
    expect(mcp.dependencies?.[sdk]).toBeUndefined()
    expect(mcp.peerDependencies).toEqual({ [sdk]: '2.1.0' })
    expect(mcp.peerDependenciesMeta?.[sdk]).toBeUndefined()
    expect(mcp.devDependencies?.[sdk]).toBe(mcp.peerDependencies[sdk])
    expect(read('package.json').devDependencies?.[sdk]).toBe(mcp.peerDependencies[sdk])
  })
})
