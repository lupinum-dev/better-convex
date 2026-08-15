import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/publish-prerelease.yml'),
  'utf8',
)
const programs = extractPrograms(workflow).map((program) =>
  dedent(program).replace(
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)',
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0)',
  ),
)
const lanes = [
  ['vue', '@lupinum/better-convex-vue'],
  ['nuxt', '@lupinum/better-convex-nuxt'],
  ['mcp', '@lupinum/better-convex-mcp'],
] as const

describe('first-package publication recovery', () => {
  it('rejects every unsafe registry state', () => {
    expect(programs).toHaveLength(lanes.length)
    const [lane, packageName] = lanes[0]
    const program = programs[0]
    if (!program) throw new Error('Vue publish program is missing.')
    runScenario(program, lane, packageName, 'missing package uses OIDC', {
      expectedMode: 'oidc',
      expectedPublishes: 1,
    })
    runScenario(program, lane, packageName, 'different bytes fail', {
      existing: true,
      differentBytes: true,
      expectedError: 'exists with different bytes',
    })
    runScenario(program, lane, packageName, 'wrong dist-tag fails', {
      existing: true,
      attested: true,
      wrongTag: true,
      expectedError: 'did not expose the required bytes',
    })
    runScenario(program, lane, packageName, 'later unproven versions fail', {
      existing: true,
      extraVersion: true,
      authorizeBootstrap: true,
      expectedError: 'is not the first package version and has no provenance',
    })
    runScenario(program, lane, packageName, 'unauthorized bootstrap fails', {
      existing: true,
      expectedError: 'requires explicit bootstrap authorization',
    })
    runScenario(program, lane, packageName, 'bootstrap status is rechecked', {
      existing: true,
      laterVersionDuringVerification: true,
      authorizeBootstrap: true,
      expectedError: 'did not expose the required bytes',
    })
    runScenario(program, lane, packageName, 'fresh publication requires provenance', {
      publishProvenance: false,
      expectedError: 'did not expose the required bytes',
    })
    runScenario(program, lane, packageName, 'registry errors stop publication', {
      registryError: true,
      expectedError: 'npm view failed',
    })
  }, 30_000)

  it('uses the same verified program and reports each lane independently', () => {
    expect(new Set(programs).size).toBe(1)
    for (const [index, [lane, packageName]] of lanes.entries()) {
      const program = programs[index]
      if (!program) throw new Error(`${lane} publish program is missing.`)
      runScenario(program, lane, packageName, 'matching bootstrap bytes', {
        existing: true,
        authorizeBootstrap: true,
        expectedMode: 'bootstrap',
        expectedPublishes: 0,
      })
      runScenario(program, lane, packageName, 'attested rerun stays idempotent', {
        existing: true,
        attested: true,
        extraVersion: true,
        expectedMode: 'oidc',
        expectedPublishes: 0,
      })
    }
  }, 30_000)
})

function runScenario(
  program: string,
  lane: string,
  packageName: string,
  scenario: string,
  options: {
    authorizeBootstrap?: boolean
    attested?: boolean
    differentBytes?: boolean
    existing?: boolean
    expectedError?: string
    expectedMode?: 'bootstrap' | 'oidc'
    expectedPublishes?: number
    extraVersion?: boolean
    laterVersionDuringVerification?: boolean
    publishProvenance?: boolean
    registryError?: boolean
    wrongTag?: boolean
  },
) {
  const root = mkdtempSync(join(tmpdir(), `bcn-${lane}-publish-`))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const version = lane === 'mcp' ? '0.1.0-beta.28' : '0.8.0-beta.40'
    const integrity = `sha512-${Buffer.alloc(64, lane).toString('base64')}`
    const versions = [version]
    if (options.extraVersion) versions.push(`${version}.1`)
    const statePath = join(root, 'registry.json')
    writeFileSync(
      statePath,
      JSON.stringify({
        packageName,
        version,
        integrity,
        existing: options.existing === true,
        registryIntegrity: options.differentBytes ? 'sha512-different' : integrity,
        attestations: options.attested ? { url: 'https://registry.example/provenance' } : null,
        versions,
        versionViews: 0,
        addLaterVersion: options.laterVersionDuringVerification === true,
        tag: options.wrongTag ? '0.0.0' : version,
        publishProvenance: options.publishProvenance !== false,
        registryError: options.registryError === true,
        publishes: 0,
      }),
    )
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
        BOOTSTRAP_PACKAGES: options.authorizeBootstrap ? packageName : '',
        FAKE_NPM_STATE: statePath,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
        LOCAL_INTEGRITY: integrity,
        PACKAGE: packageName,
        TARBALL: `${lane}.tgz`,
        VERSION: version,
      },
    })
    const diagnostic = `${result.stdout}\n${result.stderr}`
    if (options.expectedError) {
      expect(result.status, `${lane}: ${scenario} unexpectedly succeeded.`).not.toBe(0)
      expect(diagnostic, `${lane}: ${scenario}`).toContain(options.expectedError)
      return
    }
    expect(result.status, `${lane}: ${scenario}: ${diagnostic}`).toBe(0)
    expect(readFileSync(output, 'utf8')).toContain(`mode=${options.expectedMode}`)
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      publishes: number
    }
    expect(state.publishes).toBe(options.expectedPublishes)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function dedent(value: string) {
  const lines = value.split('\n')
  const indentation = Math.min(
    ...lines.filter(Boolean).map((line) => line.match(/^\s*/)?.[0].length ?? 0),
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
const statePath = process.env.FAKE_NPM_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const output = value => process.stdout.write(JSON.stringify(value) + '\\n')
if (args[0] === 'view') {
  if (state.registryError) {
    process.stderr.write('E500 registry unavailable\\n')
    process.exit(1)
  }
  const spec = args[1]
  const field = args[2]
  const versioned = spec.includes('@', 1) && spec.lastIndexOf('@') > spec.indexOf('/')
  let value
  if (!state.existing) value = undefined
  else if (field === 'dist.integrity') value = state.registryIntegrity
  else if (field === 'dist.attestations') value = state.attestations
  else if (field === 'versions') {
    if (state.addLaterVersion && state.versionViews > 0 && state.versions.length === 1) state.versions.push(state.version + '.1')
    state.versionViews += 1
    save()
    value = state.versions
  } else if (field.startsWith('dist-tags.')) value = state.tag
  if (value === undefined || value === null || (!state.existing && versioned)) {
    process.stderr.write('E404 404 Not Found\\n')
    process.exit(1)
  }
  output(value)
  process.exit(0)
}
if (args[0] === 'publish') {
  state.existing = true
  state.registryIntegrity = state.integrity
  state.attestations = state.publishProvenance ? { url: 'https://registry.example/provenance' } : null
  state.versions = [state.version]
  state.tag = state.version
  state.publishes += 1
  save()
  process.exit(0)
}
throw new Error('Unsupported fake npm command: ' + args.join(' '))
`
}
