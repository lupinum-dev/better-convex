import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/publish-prerelease.yml'),
  'utf8',
)
const [program] = extractPrograms(workflow).map((source) => dedent(source))
const packages = [
  ['vue', '@lupinum/better-convex-vue', '0.8.0-beta.40'],
  ['nuxt', '@lupinum/better-convex-nuxt', '0.8.0-beta.40'],
  ['mcp', '@lupinum/better-convex-mcp', '0.1.0-beta.28'],
] as const

interface PackageState {
  addLaterVersion?: boolean
  attestations: Record<string, string> | null
  delayedTag?: boolean
  existing: boolean
  integrity: string
  packageName: string
  publishProvenance: boolean
  publishes: number
  registryError?: boolean
  registryIntegrity: string
  tag: string
  tagViews: number
  tarball: string
  version: string
  versions: string[]
  versionViews: number
}

describe('first-package publication recovery', () => {
  it('publishes every missing package with OIDC and reports each result', () => {
    runScenario('missing packages use OIDC', {
      states: Object.fromEntries(packages.map(([, name]) => [name, { existing: false }])),
      expectedModes: { mcp: 'oidc', nuxt: 'oidc', vue: 'oidc' },
      expectedPublishes: 3,
    })
  }, 30_000)

  it('accepts matching first-version bootstrap bytes only when explicitly authorized', () => {
    runScenario('matching bootstrap set', {
      bootstrapPackages: packages.map(([, name]) => name).join(','),
      states: Object.fromEntries(
        packages.map(([, name]) => [name, { attested: false, existing: true }]),
      ),
      expectedModes: { mcp: 'bootstrap', nuxt: 'bootstrap', vue: 'bootstrap' },
      expectedPublishes: 0,
    })
  }, 30_000)

  it('recovers a partial set without republishing matching packages', () => {
    runScenario('mixed recovery', {
      bootstrapPackages: '@lupinum/better-convex-nuxt',
      states: {
        '@lupinum/better-convex-vue': { attested: true, existing: true },
        '@lupinum/better-convex-nuxt': { attested: false, existing: true },
        '@lupinum/better-convex-mcp': { existing: false },
      },
      expectedModes: { mcp: 'oidc', nuxt: 'bootstrap', vue: 'oidc' },
      expectedPublishes: 1,
    })
  }, 30_000)

  it('rejects unsafe registry and bootstrap states', () => {
    const vue = '@lupinum/better-convex-vue'
    runScenario('different bytes', {
      states: { [vue]: { differentBytes: true, existing: true } },
      expectedError: 'exists with different bytes',
    })
    runScenario('unauthorized bootstrap', {
      states: { [vue]: { attested: false, existing: true } },
      expectedError: 'requires explicit bootstrap authorization',
    })
    runScenario('later version without provenance', {
      bootstrapPackages: vue,
      states: {
        [vue]: { attested: false, existing: true, extraVersion: true },
      },
      expectedError: 'is not the first package version and has no provenance',
    })
    runScenario('wrong dist-tag', {
      states: { [vue]: { attested: true, existing: true, wrongTag: true } },
      expectedError: 'did not expose the required bytes',
    })
    runScenario('bootstrap status changes during verification', {
      bootstrapPackages: vue,
      states: {
        [vue]: { addLaterVersion: true, attested: false, existing: true },
      },
      expectedError: 'did not expose the required bytes',
    })
    runScenario('new publication lacks provenance', {
      states: { [vue]: { existing: false, publishProvenance: false } },
      expectedError: 'did not expose the required bytes',
    })
    runScenario('registry error', {
      states: { [vue]: { registryError: true } },
      expectedError: 'npm view failed',
    })
    runScenario('unknown bootstrap package', {
      bootstrapPackages: '@lupinum/not-a-package',
      expectedError: 'unique Better Convex package names',
    })
    runScenario('duplicate bootstrap package', {
      bootstrapPackages: `${vue},${vue}`,
      expectedError: 'unique Better Convex package names',
    })
  }, 30_000)

  it('bounds registry polling across the complete package set', () => {
    for (const [value, expectedError] of [
      ['0', 'Invalid registry poll attempt count'],
      ['-1', 'Invalid registry poll attempt count'],
      ['1.5', 'Invalid registry poll attempt count'],
    ] as const) {
      runScenario(`invalid poll attempts: ${value}`, {
        expectedError,
        pollAttempts: value,
      })
    }
    runScenario('negative poll delay', {
      expectedError: 'Invalid registry poll delay',
      pollDelayMs: '-1',
    })
    runScenario('fractional poll delay', {
      expectedError: 'Invalid registry poll delay',
      pollDelayMs: '0.5',
    })
    runScenario('unsafe poll window', {
      expectedError: 'Registry poll window exceeds 20 minutes',
      pollAttempts: '241',
      pollDelayMs: '5000',
    })
    runScenario('one immediate retry is valid', {
      expectedModes: { mcp: 'oidc', nuxt: 'oidc', vue: 'oidc' },
      expectedPublishes: 0,
      pollAttempts: '1',
      pollDelayMs: '0',
      states: {
        '@lupinum/better-convex-vue': {
          attested: true,
          delayedTag: true,
          existing: true,
        },
      },
    })
  }, 30_000)
})

function runScenario(
  scenario: string,
  options: {
    bootstrapPackages?: string
    expectedError?: string
    expectedModes?: Record<string, 'bootstrap' | 'oidc'>
    expectedPublishes?: number
    pollAttempts?: string
    pollDelayMs?: string
    states?: Record<
      string,
      {
        addLaterVersion?: boolean
        attested?: boolean
        delayedTag?: boolean
        differentBytes?: boolean
        existing?: boolean
        extraVersion?: boolean
        publishProvenance?: boolean
        registryError?: boolean
        wrongTag?: boolean
      }
    >
  },
) {
  if (!program) throw new Error('Publish program is missing.')
  const root = mkdtempSync(join(tmpdir(), 'bcn-package-set-publish-'))
  try {
    const bin = join(root, 'bin')
    const artifacts = join(root, '.release-artifacts')
    mkdirSync(bin)
    const packageStates: Record<string, PackageState> = {}
    for (const [lane, packageName, version] of packages) {
      const directory = join(artifacts, lane, version)
      mkdirSync(directory, { recursive: true })
      const tarball = `${lane}.tgz`
      const bytes = Buffer.from(`certified ${packageName} ${version}`)
      writeFileSync(join(directory, tarball), bytes)
      const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
      const stateOptions = options.states?.[packageName] ?? {
        attested: true,
        existing: true,
      }
      const versions: string[] = [version]
      if (stateOptions.extraVersion) versions.push(`${version}.1`)
      packageStates[packageName] = {
        addLaterVersion: stateOptions.addLaterVersion,
        attestations:
          stateOptions.attested === false ? null : { url: 'https://npm.example/provenance' },
        existing: stateOptions.existing !== false,
        delayedTag: stateOptions.delayedTag,
        integrity,
        packageName,
        publishProvenance: stateOptions.publishProvenance !== false,
        publishes: 0,
        registryError: stateOptions.registryError,
        registryIntegrity: stateOptions.differentBytes ? 'sha512-different' : integrity,
        tag: stateOptions.wrongTag ? '0.0.0' : version,
        tagViews: 0,
        tarball,
        version,
        versions,
        versionViews: 0,
      }
      writeFileSync(
        join(directory, 'artifact.json'),
        JSON.stringify({
          packageName,
          sourceCommit: 'a'.repeat(40),
          tarball: {
            file: tarball,
            integrity,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
          version,
        }),
      )
    }
    const statePath = join(root, 'registry.json')
    writeFileSync(statePath, JSON.stringify({ packages: packageStates }))
    const fakeNpm = join(bin, 'npm')
    writeFileSync(fakeNpm, fakeNpmProgram())
    chmodSync(fakeNpm, 0o755)
    const runner = join(root, 'publish.mjs')
    writeFileSync(runner, program)
    const output = join(root, 'output.txt')
    const result = spawnSync(process.execPath, [runner], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        BCN_RELEASE_DIST_TAG: 'next',
        BOOTSTRAP_PACKAGES: options.bootstrapPackages ?? '',
        FAKE_NPM_STATE: statePath,
        GITHUB_OUTPUT: output,
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
        RELEASE_VERSION: '0.8.0-beta.40',
        REGISTRY_POLL_ATTEMPTS: options.pollAttempts ?? '5',
        REGISTRY_POLL_DELAY_MS: options.pollDelayMs ?? '0',
      },
    })
    const diagnostic = `${result.stdout}\n${result.stderr}`
    if (options.expectedError) {
      expect(result.status, `${scenario} unexpectedly succeeded.`).not.toBe(0)
      expect(diagnostic, scenario).toContain(options.expectedError)
      return
    }
    expect(result.status, `${scenario}: ${diagnostic}`).toBe(0)
    const outputs = readFileSync(output, 'utf8')
    for (const [lane, mode] of Object.entries(options.expectedModes ?? {})) {
      expect(outputs).toContain(`${lane}_mode=${mode}`)
    }
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      packages: Record<string, PackageState>
    }
    expect(Object.values(state.packages).reduce((sum, value) => sum + value.publishes, 0)).toBe(
      options.expectedPublishes,
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function dedent(value: string) {
  const lines = value.split('\n')
  const indentation = Math.min(
    ...lines.filter(Boolean).map((line) => line.match(/^\s*/u)?.[0].length ?? 0),
  )
  return lines.map((line) => line.slice(indentation)).join('\n')
}

function extractPrograms(source: string) {
  const lines = source.split('\n')
  const extracted: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]?.includes("node --input-type=module <<'NODE'")) continue
    const end = lines.findIndex((line, candidate) => candidate > index && line.trim() === 'NODE')
    if (end === -1) throw new Error('Publish workflow has an unterminated inline Node program.')
    extracted.push(lines.slice(index + 1, end).join('\n'))
    index = end
  }
  return extracted
}

function fakeNpmProgram() {
  return `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const statePath = process.env.FAKE_NPM_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const output = value => process.stdout.write(JSON.stringify(value) + '\\n')
if (args[0] === 'view') {
  const spec = args[1]
  const field = args[2]
  const slash = spec.indexOf('/')
  const separator = spec.lastIndexOf('@')
  const packageName = separator > slash ? spec.slice(0, separator) : spec
  const record = state.packages[packageName]
  if (!record || record.registryError) {
    process.stderr.write(record ? 'E500 registry unavailable\\n' : 'E404 404 Not Found\\n')
    process.exit(1)
  }
  let value
  if (!record.existing) value = undefined
  else if (field === 'dist.integrity') value = record.registryIntegrity
  else if (field === 'dist.attestations') value = record.attestations
  else if (field === 'versions') {
    if (record.addLaterVersion && record.versionViews > 0 && record.versions.length === 1) {
      record.versions.push(record.version + '.1')
    }
    record.versionViews += 1
    save()
    value = record.versions
  } else if (field.startsWith('dist-tags.')) {
    if (record.delayedTag && record.tagViews === 0) value = '0.0.0'
    else value = record.tag
    record.tagViews += 1
    save()
  }
  if (value === undefined || value === null) {
    process.stderr.write('E404 404 Not Found\\n')
    process.exit(1)
  }
  output(value)
  process.exit(0)
}
if (args[0] === 'publish') {
  const tarball = path.basename(args[1])
  const record = Object.values(state.packages).find(value => value.tarball === tarball)
  if (!record) throw new Error('Unknown tarball: ' + tarball)
  record.existing = true
  record.registryIntegrity = record.integrity
  record.attestations = record.publishProvenance ? { url: 'https://npm.example/provenance' } : null
  record.versions = [record.version]
  record.tag = record.version
  record.publishes += 1
  save()
  process.exit(0)
}
throw new Error('Unsupported fake npm command: ' + args.join(' '))
`
}
