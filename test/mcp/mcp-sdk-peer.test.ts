import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const sdk = '@modelcontextprotocol/server'

describe('@lupinum/better-convex-agents SDK ownership', () => {
  it('declares the official server SDK as a peer, never as its own dependency', () => {
    // `McpServer` crosses the `./mcp` API (configureServer), so a second nested SDK copy would
    // break instanceof and protocol-version checks. The peer is optional: only `./mcp` loads it.
    const agents = read('packages/agents/package.json')
    expect(agents.dependencies?.[sdk]).toBeUndefined()
    expect(agents.peerDependencies?.[sdk]).toBeTypeOf('string')
  })
})
