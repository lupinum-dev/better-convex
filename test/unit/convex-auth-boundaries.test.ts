import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildEdges,
  discoverWorkspacePackages,
  findWorkspaceDependencyCycles,
  findWorkspaceDependencyViolations,
  RULES,
} from '../../scripts/check-boundaries.mjs'

type BoundaryEdge = {
  fromAbsPath: string
  isRelative: boolean
  isTypeOnly: boolean
  resolvedAbsPath: string | null
  specifier: string
}

function rule(name: string) {
  const match = RULES.find((candidate) => candidate.name === name)
  if (!match) throw new Error(`Missing boundary rule ${name}`)
  return match
}

function bare(specifier: string): BoundaryEdge {
  return {
    fromAbsPath: resolve('test/unit/convex-auth-boundaries.test.ts'),
    isRelative: false,
    isTypeOnly: false,
    resolvedAbsPath: null,
    specifier,
  }
}

function relativeEdge(specifier: string, resolvedAbsPath: string): BoundaryEdge {
  return {
    fromAbsPath: resolve('test/unit/convex-auth-boundaries.test.ts'),
    isRelative: true,
    isTypeOnly: false,
    resolvedAbsPath,
    specifier,
  }
}

describe('Convex auth dependency boundaries', () => {
  const islandFile = resolve('src/runtime/convex-auth/index.ts')
  const islandSibling = resolve('src/runtime/convex-auth/context.ts')
  const sharedOrigin = resolve('src/runtime/shared/auth-origin.ts')
  const sharedClientIp = resolve('src/runtime/shared/client-ip.ts')

  it('keeps the Convex auth island framework-free and edge-compatible', () => {
    const boundary = rule('convex-auth-island-framework-free')
    expect(boundary.from(islandFile)).toBe(true)
    expect(boundary.disallow(relativeEdge('./context', islandSibling))).toBe(false)
    expect(boundary.disallow(relativeEdge('../shared/auth-origin', sharedOrigin))).toBe(false)
    expect(boundary.disallow(relativeEdge('../shared/client-ip', sharedClientIp))).toBe(false)

    for (const specifier of [
      'vue',
      'nuxt',
      'nitropack/runtime',
      'h3',
      '#app',
      '~/runtime/server',
      '@/runtime/server',
      'fs',
      'node:crypto',
      'convex/browser',
      '@lupinum/better-convex-nuxt/server',
    ]) {
      expect(boundary.disallow(bare(specifier)), specifier).toBe(true)
    }
    expect(boundary.disallow(bare('convex/server'))).toBe(false)
    expect(boundary.typeOnlyExempt).toBe(false)
  })

  it('prevents module and browser surfaces from importing the backend island', () => {
    const backendEdge = relativeEdge('./runtime/convex-auth', islandFile)
    const moduleBoundary = rule('module-no-convex-auth-imports')
    const browserBoundary = rule('browser-no-convex-auth-imports')

    expect(moduleBoundary.from(resolve('src/module.ts'))).toBe(true)
    expect(moduleBoundary.disallow(backendEdge)).toBe(true)
    expect(browserBoundary.from(resolve('src/runtime/auth-client/index.ts'))).toBe(true)
    expect(browserBoundary.disallow(backendEdge)).toBe(true)
    expect(browserBoundary.disallow(bare('@lupinum/better-convex-nuxt/better-auth/server'))).toBe(
      true,
    )
  })

  it('keeps the shared origin parser dependency-free', () => {
    const boundary = rule('shared-auth-origin-dependency-free')
    expect(boundary.from(sharedOrigin)).toBe(true)
    expect(boundary.disallow(bare('convex/server'))).toBe(true)
    expect(boundary.typeOnlyExempt).toBe(false)
  })

  it('keeps the shared client IP signer dependency-free', () => {
    const boundary = rule('shared-client-ip-dependency-free')
    expect(boundary.from(sharedClientIp)).toBe(true)
    expect(boundary.disallow(bare('convex/server'))).toBe(true)
    expect(boundary.typeOnlyExempt).toBe(false)
  })

  it('resolves emitted .js specifiers to their TypeScript source target', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcn-boundary-resolution-'))
    try {
      const source = join(directory, 'source.ts')
      const target = join(directory, 'target.ts')
      writeFileSync(source, "export { target } from './target.js'\n")
      writeFileSync(target, 'export const target = true\n')

      expect(buildEdges(source)).toEqual([
        {
          fromAbsPath: source,
          isRelative: true,
          isTypeOnly: false,
          resolvedAbsPath: target,
          specifier: './target.js',
        },
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects computed dynamic imports that cannot be statically audited', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcn-boundary-dynamic-import-'))
    try {
      const source = join(directory, 'source.ts')
      writeFileSync(source, "void import(['node', 'path'].join(':'))\n")

      const [edge] = buildEdges(source)
      expect(edge).toBeDefined()
      if (!edge) throw new Error('Expected one computed dynamic import edge.')
      expect(edge).toMatchObject({
        isRelative: false,
        isTypeOnly: false,
        specifier: '<computed dynamic import>',
      })
      expect(rule('convex-auth-island-framework-free').disallow(edge)).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('private client lifecycle dependency boundary', () => {
  const clientCoreFile = resolve('packages/vue/src/internal/client-owner.ts')
  const clientCoreSibling = resolve('packages/vue/src/internal/identity-port.ts')
  const errorAuthority = resolve('packages/vue/src/errors.ts')
  const nuxtRuntime = resolve('src/runtime/runtime-context.ts')
  const serverRuntime = resolve('src/runtime/server/utils/server-convex-caller.ts')
  const mcpRuntime = resolve('src/runtime/mcp/route.ts')

  it('admits only the private island, existing errors, Vue, and reviewed Convex entries', () => {
    const boundary = rule('client-lifecycle-island-browser-only')
    expect(boundary.from(clientCoreFile)).toBe(true)
    expect(boundary.from(resolve('src/runtime/composables/useConvexQuery.ts'))).toBe(false)
    expect(boundary.disallow(relativeEdge('./identity-port', clientCoreSibling))).toBe(false)
    expect(boundary.disallow(relativeEdge('../errors', errorAuthority))).toBe(false)

    for (const specifier of ['vue', 'convex/browser', 'convex/server', 'convex/values']) {
      expect(boundary.disallow(bare(specifier)), specifier).toBe(false)
    }
  })

  it('rejects framework, auth, server, MCP, Node, alias, and unreviewed utility edges', () => {
    const boundary = rule('client-lifecycle-island-browser-only')

    for (const specifier of [
      '#imports',
      '#app',
      'nuxt',
      '@nuxt/kit',
      'nitropack/runtime',
      'h3',
      'better-auth/vue',
      'node:crypto',
      'fs',
      '~/runtime/utils/logger',
      '@/runtime/auth/client-engine',
      '@lupinum/better-convex-nuxt/server',
      '<computed dynamic import>',
    ]) {
      expect(boundary.disallow(bare(specifier)), specifier).toBe(true)
    }

    expect(boundary.disallow(relativeEdge('../runtime-context', nuxtRuntime))).toBe(true)
    expect(
      boundary.disallow(relativeEdge('../server/utils/server-convex-caller', serverRuntime)),
    ).toBe(true)
    expect(boundary.disallow(relativeEdge('../mcp/route', mcpRuntime))).toBe(true)
    expect(
      boundary.disallow(relativeEdge('../utils/logger', resolve('src/runtime/utils/logger.ts'))),
    ).toBe(true)
    expect(boundary.typeOnlyExempt).toBe(false)
  })
})

describe('workspace package dependency direction', () => {
  function workspacePackage(
    directory: string,
    name: string,
    dependencies: Record<string, string> = {},
  ) {
    return {
      directory,
      manifest: { name, dependencies },
      name,
    }
  }

  it('discovers the root and current workspace package ownership', () => {
    const packages = discoverWorkspacePackages()
    expect(packages.map((item) => item.name).sort()).toEqual([
      '@lupinum/better-convex-mcp',
      '@lupinum/better-convex-nuxt',
      '@lupinum/better-convex-vue',
      'better-convex-nuxt-playground',
    ])
  })

  it('rejects relative imports that bypass another package public entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcn-workspace-relative-'))
    try {
      const packageA = join(directory, 'packages/a')
      const packageB = join(directory, 'packages/b')
      const source = join(packageA, 'src/index.ts')
      const target = join(packageB, 'src/index.ts')
      mkdirSync(join(packageA, 'src'), { recursive: true })
      mkdirSync(join(packageB, 'src'), { recursive: true })
      writeFileSync(source, "export { value } from '../../b/src/index.js'\n")
      writeFileSync(target, 'export const value = true\n')

      const violations = findWorkspaceDependencyViolations(
        [source, target],
        [workspacePackage(packageA, '@fixture/a'), workspacePackage(packageB, '@fixture/b')],
      )
      expect(violations).toEqual([
        expect.objectContaining({
          kind: 'relative-cross-package',
          specifier: '../../b/src/index.js',
        }),
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires bare workspace imports to be declared by the importer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcn-workspace-declaration-'))
    try {
      const packageA = join(directory, 'packages/a')
      const packageB = join(directory, 'packages/b')
      const source = join(packageA, 'src/index.ts')
      mkdirSync(join(packageA, 'src'), { recursive: true })
      writeFileSync(source, "export { value } from '@fixture/b/subpath'\n")

      expect(
        findWorkspaceDependencyViolations(
          [source],
          [workspacePackage(packageA, '@fixture/a'), workspacePackage(packageB, '@fixture/b')],
        ),
      ).toEqual([
        expect.objectContaining({
          kind: 'undeclared-workspace-import',
          specifier: '@fixture/b/subpath',
        }),
      ])

      expect(
        findWorkspaceDependencyViolations(
          [source],
          [
            workspacePackage(packageA, '@fixture/a', {
              '@fixture/b': 'workspace:*',
            }),
            workspacePackage(packageB, '@fixture/b'),
          ],
        ),
      ).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects cycles in the declared workspace package graph', () => {
    const directory = resolve('/tmp/bcn-workspace-cycle')
    const packages = [
      workspacePackage(directory + '/a', '@fixture/a', {
        '@fixture/b': 'workspace:*',
      }),
      workspacePackage(directory + '/b', '@fixture/b', {
        '@fixture/a': 'workspace:*',
      }),
    ]
    expect(findWorkspaceDependencyCycles(packages)).toEqual([
      ['@fixture/a', '@fixture/b', '@fixture/a'],
    ])
  })
})
