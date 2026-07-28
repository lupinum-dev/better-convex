import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const vuePackageManifest = JSON.parse(
  readFileSync(join(root, 'packages/vue/package.json'), 'utf8'),
) as {
  devDependencies: Record<string, string>
}
const mcpPackageManifest = JSON.parse(
  readFileSync(join(root, 'packages/mcp/package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>
}

function run(args: string[]) {
  return spawnSync(process.execPath, ['scripts/generate-sbom.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

function withCandidateManifest(
  change: (manifest: Record<string, unknown>) => void,
  test: (manifestPath: string, directory: string) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'bcn-sbom-profile-'))
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    change(manifest)
    const manifestPath = join(directory, 'package.json')
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
    test(manifestPath, directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('package-profile SBOM generation', () => {
  it('roots the Nuxt SBOM in the reviewed package and preserves consumer peers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcn-sbom-output-'))
    try {
      const output = join(directory, 'sbom.cdx.json')
      const result = run(['--package', 'nuxt', '--output', output])
      expect(result.status, result.stderr).toBe(0)

      const sbom = JSON.parse(readFileSync(output, 'utf8')) as {
        components: Array<{
          name: string
          properties?: Array<{ name: string; value: string }>
        }>
        metadata: { component: { name: string } }
      }
      expect(sbom.metadata.component.name).toBe('better-convex-nuxt')
      for (const peer of ['better-auth', 'convex', 'kysely', 'nuxt']) {
        expect(sbom.components).toContainEqual(
          expect.objectContaining({
            name: peer,
            properties: [
              {
                name: 'better-convex-nuxt:dependency-kind',
                value: 'required-peer',
              },
            ],
          }),
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)

  it('roots the Vue SBOM in exactly its four production components', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcv-sbom-output-'))
    try {
      const output = join(directory, 'sbom.cdx.json')
      const result = run(['--package', 'vue', '--output', output])
      expect(result.status, result.stderr).toBe(0)

      const sbom = JSON.parse(readFileSync(output, 'utf8')) as {
        components: Array<{
          name: string
          version: string
          properties?: Array<{ name: string; value: string }>
        }>
        metadata: { component: { name: string } }
      }
      expect(sbom.metadata.component.name).toBe('better-convex-vue')
      expect(sbom.components.map(({ name }) => name).sort()).toEqual([
        '@modelcontextprotocol/ext-apps',
        'convex',
        'ohash',
        'vue',
      ])
      expect(sbom.components.find(({ name }) => name === '@modelcontextprotocol/ext-apps')).toEqual(
        expect.objectContaining({
          version: '1.7.5',
          properties: [
            {
              name: 'better-convex-vue:dependency-kind',
              value: 'optional-peer',
            },
          ],
        }),
      )
      expect(sbom.components.find(({ name }) => name === 'convex')?.version).toBe(
        vuePackageManifest.devDependencies.convex,
      )
      expect(sbom.components.find(({ name }) => name === 'vue')?.version).toBe(
        vuePackageManifest.devDependencies.vue,
      )
      for (const peer of ['convex', 'vue']) {
        expect(sbom.components).toContainEqual(
          expect.objectContaining({
            name: peer,
            properties: [
              {
                name: 'better-convex-vue:dependency-kind',
                value: 'required-peer',
              },
            ],
          }),
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)

  it('roots the MCP SBOM in the exact official server SDK', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bcm-sbom-output-'))
    try {
      const output = join(directory, 'sbom.cdx.json')
      const result = run(['--package', 'mcp', '--output', output])
      expect(result.status, result.stderr).toBe(0)

      const sbom = JSON.parse(readFileSync(output, 'utf8')) as {
        components: Array<{ name: string; version: string }>
        metadata: { component: { name: string } }
      }
      expect(sbom.metadata.component.name).toBe('@better-convex/mcp')
      expect(sbom.components.map(({ name }) => name).sort()).toEqual([
        '@modelcontextprotocol/core',
        '@modelcontextprotocol/server',
        'zod',
      ])
      expect(sbom.components).toContainEqual(
        expect.objectContaining({
          name: '@modelcontextprotocol/server',
          version: mcpPackageManifest.dependencies['@modelcontextprotocol/server'],
        }),
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)

  it('rejects unknown package selectors before generating evidence', () => {
    const result = run(['--package', 'not-reviewed', '--check'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown package certification descriptor: not-reviewed')
  })

  it('rejects a candidate manifest with another package identity', () => {
    withCandidateManifest(
      (manifest) => {
        manifest.name = 'lookalike-package'
      },
      (manifestPath) => {
        const result = run(['--package', 'nuxt', '--root-manifest', manifestPath, '--check'])
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('SBOM root manifest has an invalid package identity')
      },
    )
  })

  it('rejects candidate dependencies absent from the frozen selected workspace graph', () => {
    withCandidateManifest(
      (manifest) => {
        manifest.dependencies = {
          ...(manifest.dependencies as Record<string, unknown>),
          'candidate-only-dependency': '1.0.0',
        }
      },
      (manifestPath) => {
        const result = run(['--package', 'nuxt', '--root-manifest', manifestPath, '--check'])
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
          'Frozen workspace graph cannot resolve candidate dependency candidate-only-dependency',
        )
      },
    )
  }, 120_000)

  it('rejects ambiguous modes and caller-supplied profile-like arguments', () => {
    expect(run(['--package', 'nuxt', '--check', '--output', 'ignored.json']).status).toBe(1)
    const result = run([
      '--package',
      'nuxt',
      '--profile',
      'nuxt-production-dependencies',
      '--check',
    ])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown SBOM argument: --profile')
  })
})
