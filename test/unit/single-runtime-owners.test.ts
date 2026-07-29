import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  findNuxtClientEngineViolations,
  findSingleRuntimeOwnerViolations,
} from '../../scripts/check-single-runtime-owners.mjs'

function write(root: string, path: string, contents: string) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

describe('Nuxt client-engine absence gate', () => {
  const directories: string[] = []
  const createRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'bcn-no-nuxt-client-engine-'))
    directories.push(root)
    return root
  }

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

  it('accepts public Vue package facades without a second engine', () => {
    const root = createRoot()
    write(
      root,
      'src/runtime/composables/useConvexMutation.ts',
      "import { useConvexMutation } from 'better-convex-vue'\n",
    )
    write(
      root,
      'dist/runtime/composables/useConvexMutation.js',
      "import { useConvexMutation } from 'better-convex-vue'\n",
    )

    expect(findNuxtClientEngineViolations(root, { dist: true })).toEqual([])
  })

  it('rejects removed source paths, private imports, controller ownership, and bundled engines', () => {
    const root = createRoot()
    write(root, 'src/runtime/client-core/query-controller.ts', 'export const old = true\n')
    write(
      root,
      'src/runtime/private.ts',
      "import 'better-convex-vue/internal'\ncreateClientOwner()\n",
    )
    write(root, 'dist/runtime/plugin.js', 'createCallableController()\n')

    expect(findNuxtClientEngineViolations(root, { dist: true })).toEqual(
      expect.arrayContaining([
        'removed path exists: src/runtime/client-core',
        'src/runtime/private.ts: forbidden better-convex-vue/internal',
        'src/runtime/private.ts: forbidden createClientOwner',
        'dist/runtime/plugin.js: forbidden createCallableController',
      ]),
    )
  })

  it('fails a requested dist proof when no build exists', () => {
    const root = createRoot()
    write(root, 'src/runtime/plugin.ts', "import { createBetterConvex } from 'better-convex-vue'\n")

    expect(findNuxtClientEngineViolations(root, { dist: true })).toContain(
      'dist root is missing: dist',
    )
  })
})

describe('single runtime-owner gate', () => {
  const directories: string[] = []
  const createRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'bcn-single-runtime-owner-'))
    directories.push(root)
    write(root, 'src/runtime/plugin.ts', "import { createBetterConvex } from 'better-convex-vue'\n")
    write(
      root,
      'packages/mcp/src/handler.ts',
      "import { McpServer } from '@modelcontextprotocol/server'\nnew McpServer({ name: 'fixture', version: '1' })\n",
    )
    write(
      root,
      'starters/mcp-oauth-agent/convex/mcp.ts',
      "import type { McpServer } from '@modelcontextprotocol/server'\nexport type Server = McpServer\n",
    )
    write(root, 'packages/vue/src/index.ts', 'export const vueRuntime = true\n')
    return root
  }

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

  it('accepts one Vue lifecycle owner and one official MCP server owner', () => {
    expect(findSingleRuntimeOwnerViolations(createRoot())).toEqual([])
  })

  it('inspects Vue script blocks with whitespace in the closing tag', () => {
    const root = createRoot()
    write(
      root,
      'starters/rogue-mcp/App.vue',
      "<script setup>\nimport { McpServer } from '@modelcontextprotocol/server'\nnew McpServer({ name: 'rogue', version: '1' })\n</script >\n",
    )

    expect(findSingleRuntimeOwnerViolations(root)).toEqual(
      expect.arrayContaining([
        'starters/rogue-mcp/App.vue: MCP server runtime import outside packages/mcp/src',
        'starters/rogue-mcp/App.vue: McpServer construction outside packages/mcp/src/handler.ts',
        'expected exactly one McpServer construction, found 2',
      ]),
    )
  })

  it('rejects a second MCP runtime import, constructor, parser, and removed implementation', () => {
    const root = createRoot()
    write(
      root,
      'starters/rogue-mcp/server.ts',
      "import { McpServer } from '@modelcontextprotocol/server'\nnew McpServer({ name: 'rogue', version: '1' })\nconst method = 'tools/list'\n",
    )
    write(root, 'src/runtime/server/mcp/parser.ts', "export const method = 'jsonrpc'\n")

    expect(findSingleRuntimeOwnerViolations(root)).toEqual(
      expect.arrayContaining([
        'removed path exists: src/runtime/server/mcp',
        'starters/rogue-mcp/server.ts: MCP server runtime import outside packages/mcp/src',
        'starters/rogue-mcp/server.ts: McpServer construction outside packages/mcp/src/handler.ts',
        'starters/rogue-mcp/server.ts: hand-written MCP protocol literal "tools/list"',
        'src/runtime/server/mcp/parser.ts: hand-written MCP protocol literal "jsonrpc"',
        'expected exactly one McpServer construction, found 2',
      ]),
    )
  })

  it('proves the built Nuxt, Vue, and MCP ownership boundary', () => {
    const root = createRoot()
    write(
      root,
      'dist/runtime/plugin.mjs',
      "import { createBetterConvex } from 'better-convex-vue'\n",
    )
    write(
      root,
      'packages/mcp/dist/index.mjs',
      "import { McpServer } from '@modelcontextprotocol/server'\nnew McpServer({ name: 'fixture', version: '1' })\n",
    )
    write(root, 'packages/vue/dist/index.mjs', 'export const vueRuntime = true\n')

    expect(findSingleRuntimeOwnerViolations(root, { dist: true })).toEqual([])

    write(
      root,
      'dist/runtime/rogue.mjs',
      "import { McpServer } from '@modelcontextprotocol/server'\n",
    )
    expect(findSingleRuntimeOwnerViolations(root, { dist: true })).toContain(
      'dist/runtime/rogue.mjs: MCP server implementation leaked into Nuxt dist',
    )
  })
})
