import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../..')
const releaseControlFixtureFiles = [
  'package.json',
  'packages/mcp/package.json',
  'packages/vue/package.json',
  'scripts/package-artifact-coordinates.mjs',
  'scripts/package-artifact-evidence.mjs',
  'scripts/package-candidate-set.mjs',
  'scripts/package-certification-manifest.mjs',
  'scripts/package-runtime-fingerprint-profile.mjs',
  'scripts/prepare-candidate-set.mjs',
  'scripts/release-preflight-tarballs.mjs',
  'scripts/verify-release.mjs',
]

interface WorkflowStep {
  'continue-on-error'?: unknown
  env?: Record<string, unknown>
  id?: string
  if?: unknown
  name?: string
  run?: unknown
  uses?: unknown
  with?: Record<string, unknown>
}

interface WorkflowJob {
  'continue-on-error'?: unknown
  concurrency?: { group?: unknown }
  environment?: unknown
  if?: unknown
  needs?: string | string[]
  permissions?: Record<string, unknown>
  steps?: WorkflowStep[]
  'timeout-minutes'?: unknown
}

interface Workflow {
  env?: Record<string, unknown>
  jobs?: Record<string, WorkflowJob>
  permissions?: Record<string, unknown>
}

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8')
}

function parseWorkflow(path: string): Workflow {
  return parse(read(path)) as Workflow
}

function requireJob(workflow: Workflow, jobId: string): WorkflowJob {
  const job = workflow.jobs?.[jobId]
  if (!job) throw new Error(`Missing workflow job: ${jobId}`)
  return job
}

function needs(workflow: Workflow, jobId: string): string[] {
  const value = requireJob(workflow, jobId).needs
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function steps(workflow: Workflow, jobId: string): WorkflowStep[] {
  return requireJob(workflow, jobId).steps ?? []
}

function normalizedRun(step: WorkflowStep): string | null {
  return typeof step.run === 'string' ? step.run.replace(/\s+/gu, ' ').trim() : null
}

function runs(workflow: Workflow, jobId: string): string[] {
  return steps(workflow, jobId)
    .map(normalizedRun)
    .filter((run): run is string => run !== null)
}

function uses(workflow: Workflow): string[] {
  return Object.values(workflow.jobs ?? {}).flatMap((job) =>
    (job.steps ?? [])
      .map((step) => step.uses)
      .filter((value): value is string => typeof value === 'string'),
  )
}

function createReleaseControlFixture() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'bcn-release-family-'))
  const repository = join(temporaryDirectory, 'repository')
  for (const relativePath of releaseControlFixtureFiles) {
    const destination = join(repository, relativePath)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, read(relativePath))
  }
  mkdirSync(join(repository, 'scripts/package-check'), { recursive: true })
  writeFileSync(
    join(repository, 'scripts/package-check/tarball.mjs'),
    "export function inspectTarballArchive() { throw new Error('not used by release-control fixture') }\n",
  )
  symlinkSync(join(root, 'node_modules'), join(repository, 'node_modules'), 'dir')
  return { repository, temporaryDirectory }
}

function preparationCommands(workflow: Workflow, jobId: string) {
  return runs(workflow, jobId).filter((run) =>
    /release:prepare|prepare-candidate-set\.mjs (?:family|prepare)|release\.mjs prepare/u.test(run),
  )
}

describe('trusted prerelease workflow', () => {
  const workflow = parseWorkflow('.github/workflows/publish-prerelease.yml')
  const ciWorkflow = parseWorkflow('.github/workflows/ci.yml')
  const previewWorkflow = parseWorkflow('.github/workflows/package-preview.yml')

  it('runs one clean-checkout family command from an empty artifact root in dependency order', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>
    }
    expect(packageJson.scripts?.['release:prepare']).toBe(
      'node scripts/prepare-candidate-set.mjs family',
    )
    expect(packageJson.scripts?.['release:prepare:set']).toBeUndefined()

    const { repository, temporaryDirectory } = createReleaseControlFixture()
    const fakeBin = join(temporaryDirectory, 'bin')
    mkdirSync(fakeBin)
    const fakeNode = join(fakeBin, 'node')
    const fakeNodeDriver = join(fakeBin, 'node-driver.mjs')
    const fakeGit = join(fakeBin, 'git')
    const executionLog = join(temporaryDirectory, 'executed.log')
    writeFileSync(
      fakeNode,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeNodeDriver)} "$@"\n`,
    )
    writeFileSync(
      fakeNodeDriver,
      `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const args = process.argv.slice(2)
appendFileSync(process.env.BCN_RELEASE_FAMILY_TEST_LOG, args.join(' ') + '\\n')
if (args[0] === 'scripts/release.mjs' && args[1] === 'artifact') {
  const packageId = args[args.indexOf('--package') + 1]
  const module = await import(pathToFileURL(resolve('scripts/package-artifact-coordinates.mjs')).href)
  const coordinates = module.getPackageArtifactCoordinates(packageId, { repositoryRoot: process.cwd() })
  const workspace = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const integrity = 'sha512-' + Buffer.alloc(64).toString('base64')
  const evidence = {
    schemaVersion: 3,
    packageId: coordinates.packageId,
    packageName: coordinates.packageName,
    packageDirectory: coordinates.packageDirectory,
    version: coordinates.version,
    profiles: coordinates.profiles,
    sourceCommit: '0'.repeat(40),
    packageManager: workspace.packageManager,
    node: 'fixture', npm: 'fixture', pnpm: 'fixture', sourceTree: 'clean',
    runtimeFingerprint: packageId === 'nuxt' ? 'bcn-release-v1-' + '0'.repeat(64) : null,
    tarball: { file: coordinates.files.tarball, bytes: 1, sha256: '1'.repeat(64), integrity },
    contents: { file: coordinates.files.contents, bytes: 1, sha256: '2'.repeat(64) },
    sbom: { file: coordinates.files.sbom, bytes: 1, sha256: '3'.repeat(64) },
  }
  mkdirSync(coordinates.directory, { recursive: true })
  writeFileSync(coordinates.paths.evidence, JSON.stringify(evidence) + '\\n')
}
`,
    )
    writeFileSync(fakeGit, '#!/bin/sh\nexit 0\n')
    chmodSync(fakeNode, 0o755)
    chmodSync(fakeGit, 0o755)

    try {
      const result = spawnSync(
        process.execPath,
        [join(repository, 'scripts/prepare-candidate-set.mjs'), 'family'],
        {
          cwd: repository,
          encoding: 'utf8',
          env: {
            ...process.env,
            BCN_RELEASE_FAMILY_TEST_LOG: executionLog,
            PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
          },
        },
      )
      expect(result.status, result.stderr).toBe(0)
      const commands = readFileSync(executionLog, 'utf8').trim().split('\n')
      expect(commands.slice(0, 4)).toEqual([
        'scripts/prepare-candidate-app-locks.mjs check',
        'scripts/release.mjs artifact --package vue',
        'scripts/release.mjs artifact --package nuxt',
        'scripts/release.mjs artifact --package mcp',
      ])
      expect(commands.slice(4)).toEqual(
        expect.arrayContaining([
          'scripts/verify-release.mjs --package vue --artifact-manifest .release-artifacts/vue/0.8.0-beta.40/artifact.json',
          'scripts/verify-release.mjs --package nuxt --artifact-manifest .release-artifacts/nuxt/0.8.0-beta.40/artifact.json',
        ]),
      )
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('names a missing retained companion and the command that produces it', () => {
    const { repository, temporaryDirectory } = createReleaseControlFixture()
    const fakeBin = join(temporaryDirectory, 'bin')
    mkdirSync(fakeBin)
    const fakeNode = join(fakeBin, 'node')
    writeFileSync(fakeNode, '#!/bin/sh\nexit 0\n')
    chmodSync(fakeNode, 0o755)
    const version = (JSON.parse(read('package.json')) as { version: string }).version

    try {
      const result = spawnSync(
        process.execPath,
        [
          join(repository, 'scripts/verify-release.mjs'),
          '--artifact-manifest',
          `.release-artifacts/nuxt/${version}/artifact.json`,
        ],
        {
          cwd: repository,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
          },
        },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('retained mcp companion artifact is missing')
      expect(result.stderr).toContain('produce it with `pnpm release:prepare`')
      expect(result.stderr).not.toContain('ENOENT')
      expect(existsSync(join(repository, '.release-artifacts'))).toBe(false)
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('keeps post-mint verification artifact-only', () => {
    const verifier = read('scripts/verify-release.mjs')

    expect(verifier).toContain("'scripts/check-package-exports.mjs'")
    expect(verifier).toContain("'scripts/check-candidate-apps.mjs'")
    expect(verifier).not.toContain("run('pnpm', ['run', 'check'])")
    expect(verifier).not.toContain("run('pnpm', ['run', 'verify:auth'])")
    expect(verifier).not.toContain("run('pnpm', ['run', 'test:e2e:full'])")
  })

  it('rejects unreviewed verifier and registry coordinates before network work', () => {
    const verifier = spawnSync(
      process.execPath,
      ['scripts/verify-release.mjs', '--artifact-manifest', 'unreviewed/artifact.json'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(verifier.status).toBe(1)
    expect(verifier.stderr).toContain(
      'artifact manifest must be the reviewed nuxt coordinate: .release-artifacts/nuxt/',
    )

    const registryConsumer = spawnSync(
      process.execPath,
      [
        'scripts/check-nuxt-registry-vue-consumer.mjs',
        '--artifact-set',
        '../unreviewed/artifact-set.json',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(registryConsumer.status).toBe(1)
    expect(registryConsumer.stderr).toContain(
      'Candidate-set manifest is not at the reviewed artifact coordinate',
    )

    const comparator = spawnSync(
      process.execPath,
      ['scripts/compare-registry-package.mjs', '--package', 'unreviewed'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(comparator.status).toBe(1)
    expect(comparator.stderr).toContain('Unknown package certification descriptor')

    const publisher = spawnSync(
      process.execPath,
      ['scripts/publish-registry-package.mjs', '--package', 'unreviewed', '--tag', 'candidate-123'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(publisher.status).toBe(1)
    expect(publisher.stderr).toContain('Unknown package certification descriptor')

    const sharedTagPublisher = spawnSync(
      process.execPath,
      ['scripts/publish-registry-package.mjs', '--package', 'vue', '--tag', 'next-staging'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(sharedTagPublisher.status).toBe(1)
    expect(sharedTagPublisher.stderr).toContain('requires a workflow-run-specific candidate tag')
  })

  it('publishes only after an authoritative registry E404 and resumes exact versions', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'bcn-registry-publish-'))
    const fakeBin = join(temporaryDirectory, 'bin')
    const fakeNpm = join(fakeBin, 'npm')
    const executionLog = join(temporaryDirectory, 'executed.log')
    const version = (JSON.parse(read('packages/vue/package.json')) as { version: string }).version
    mkdirSync(fakeBin)
    writeFileSync(
      fakeNpm,
      `#!/bin/sh
if [ "$1" = "view" ]; then
  if [ "$BCN_FAKE_NPM_MODE" = "present" ]; then
    printf '"%s"\\n' "$BCN_FAKE_NPM_VERSION"
    exit 0
  fi
  if [ "$BCN_FAKE_NPM_MODE" = "missing" ]; then
    printf '{"error":{"code":"E404"}}\\n' >&2
    exit 1
  fi
  printf '{"error":{"code":"E500"}}\\n' >&2
  exit 1
fi
printf '%s\\n' "$*" >> "$BCN_FAKE_NPM_LOG"
`,
    )
    chmodSync(fakeNpm, 0o755)

    const runPublisher = (mode: string) =>
      spawnSync(
        process.execPath,
        ['scripts/publish-registry-package.mjs', '--package', 'vue', '--tag', 'candidate-123'],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            BCN_FAKE_NPM_LOG: executionLog,
            BCN_FAKE_NPM_MODE: mode,
            BCN_FAKE_NPM_VERSION: version,
            PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
          },
        },
      )

    try {
      const present = runPublisher('present')
      expect(present.status, present.stderr).toBe(0)
      expect(present.stdout).toContain('publication is skipped')
      expect(existsSync(executionLog)).toBe(false)

      const unavailable = runPublisher('unavailable')
      expect(unavailable.status).toBe(1)
      expect(unavailable.stderr).toContain('without an authoritative E404')
      expect(existsSync(executionLog)).toBe(false)

      const missing = runPublisher('missing')
      expect(missing.status, missing.stderr).toBe(0)
      expect(readFileSync(executionLog, 'utf8')).toContain(
        `publish ${resolve(root, `.release-artifacts/vue/${version}/better-convex-vue-${version}.tgz`)} --tag candidate-123 --access public --registry https://registry.npmjs.org`,
      )
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('keeps CI source-only and package previews non-authoritative', () => {
    expect(preparationCommands(ciWorkflow, 'release-gate')).toEqual([])
    expect(preparationCommands(previewWorkflow, 'preview')).toEqual([])
    expect(runs(previewWorkflow, 'preview')).toContain('node scripts/build-package-preview.mjs')
    expect(requireJob(ciWorkflow, 'release-gate')['timeout-minutes']).toBe(5)
    expect(needs(ciWorkflow, 'release-gate')).toEqual([
      'secrets',
      'compatibility',
      'auth-contracts',
      'auth-real-backend',
    ])
  })

  it('models the exact blocking publication DAG', () => {
    expect(
      Object.fromEntries(
        Object.keys(workflow.jobs ?? {}).map((jobId) => [jobId, needs(workflow, jobId)]),
      ),
    ).toEqual({
      'preflight-smoke': [],
      'source-certification': ['preflight-smoke'],
      'release-security': ['source-certification'],
      'staging-readiness': ['release-security'],
      'build-candidates': ['staging-readiness'],
      'verify-candidates': ['build-candidates'],
      'bcn-auth-staging': ['verify-candidates'],
      'publish-vue-staging': ['bcn-auth-staging'],
      'registry-vue-nuxt-gate': ['publish-vue-staging'],
      'publish-nuxt-staging': ['registry-vue-nuxt-gate'],
      'registry-nuxt-gate': ['publish-nuxt-staging'],
      'publish-mcp-staging': ['registry-nuxt-gate'],
      'registry-mcp-gate': ['publish-mcp-staging'],
      'staged-candidate-set-complete': [
        'registry-vue-nuxt-gate',
        'registry-nuxt-gate',
        'registry-mcp-gate',
      ],
      'github-prerelease': ['staged-candidate-set-complete'],
    })
  })

  it('runs each expensive source suite once before immutable minting', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>
    }
    const source = read('scripts/release-source-certification.mjs')
    const verifier = read('scripts/verify-release.mjs')
    const allSourceRuns = [
      ...runs(ciWorkflow, 'compatibility'),
      ...runs(ciWorkflow, 'auth-contracts'),
      ...runs(ciWorkflow, 'auth-real-backend'),
    ]
    expect(allSourceRuns.filter((run) => run === 'pnpm release:certify:source core')).toHaveLength(
      1,
    )
    expect(allSourceRuns.filter((run) => run === 'pnpm release:certify:source auth')).toHaveLength(
      1,
    )
    expect(allSourceRuns.filter((run) => run === 'pnpm release:certify:source e2e')).toHaveLength(1)
    expect(source.match(/\['run', 'verify'\]/gu)).toHaveLength(1)
    expect(source.match(/\['run', 'verify:auth'\]/gu)).toHaveLength(1)
    expect(source.match(/\['run', 'test:e2e:full'\]/gu)).toHaveLength(1)
    expect(packageJson.scripts?.['test:e2e:full']).toBe(
      'pnpm --dir packages/vue build && node scripts/run-e2e.mjs --full',
    )
    expect(verifier).not.toMatch(/verify:auth|test:e2e:full|test:dast:proxy/u)
    expect(needs(workflow, 'build-candidates')).toEqual(['staging-readiness'])
  })

  it('keeps staging readiness read-only and before artifact creation', () => {
    const readinessRuns = runs(workflow, 'staging-readiness')
    expect(readinessRuns).toContain('pnpm test:auth-cloud-staging --readiness-only')
    expect(readinessRuns.join('\n')).not.toMatch(
      /release\.mjs artifact|convex deploy|vercel deploy/u,
    )
    expect(needs(workflow, 'staging-readiness')).toEqual(['release-security'])
    expect(needs(workflow, 'build-candidates')).toEqual(['staging-readiness'])
  })

  it('builds and transfers each immutable candidate through its reviewed coordinate', () => {
    expect(runs(workflow, 'build-candidates')).toEqual(
      expect.arrayContaining([
        'pnpm release:artifact:set',
        'node scripts/release.mjs artifact --package mcp',
      ]),
    )
    expect(
      steps(workflow, 'build-candidates')
        .filter((step) => step.uses?.toString().startsWith('actions/upload-artifact@'))
        .map((step) => step.with?.name),
    ).toEqual([
      '${{ steps.candidate_set.outputs.artifact_name }}',
      '${{ steps.mcp.outputs.artifact_name }}',
    ])
    expect(
      steps(workflow, 'verify-candidates')
        .filter((step) => step.uses?.toString().startsWith('actions/download-artifact@'))
        .map((step) => step.with?.name),
    ).toEqual([
      '${{ steps.candidate_set.outputs.artifact_name }}',
      '${{ steps.mcp.outputs.artifact_name }}',
    ])
    expect(runs(workflow, 'verify-candidates')).toEqual(
      expect.arrayContaining([
        'pnpm release:verify:set "${{ steps.candidate_set.outputs.evidence }}"',
        'pnpm release:verify --package vue --artifact-manifest "${{ steps.vue.outputs.evidence }}"',
        'pnpm release:verify --package nuxt --artifact-manifest "${{ steps.nuxt.outputs.evidence }}"',
        'pnpm release:verify --package mcp --artifact-manifest "${{ steps.mcp.outputs.evidence }}"',
      ]),
    )
  })

  it('retries post-mint work against transferred bytes without rebuilding', () => {
    const postMintJobs = [
      'verify-candidates',
      'bcn-auth-staging',
      'publish-vue-staging',
      'registry-vue-nuxt-gate',
      'publish-nuxt-staging',
      'registry-nuxt-gate',
      'publish-mcp-staging',
      'registry-mcp-gate',
    ]
    const postMintRuns = postMintJobs.flatMap((jobId) => runs(workflow, jobId))
    expect(postMintRuns.join('\n')).not.toMatch(
      /release:artifact|prepare-candidate-set\.mjs|release\.mjs artifact/u,
    )
    for (const jobId of ['verify-candidates', 'bcn-auth-staging']) {
      expect(
        steps(workflow, jobId)
          .filter((step) => step.uses?.toString().startsWith('actions/download-artifact@'))
          .map((step) => step.with?.name),
      ).toEqual([
        '${{ steps.candidate_set.outputs.artifact_name }}',
        '${{ steps.mcp.outputs.artifact_name }}',
      ])
    }
    expect(
      postMintRuns.filter(
        (run) =>
          run.startsWith('node scripts/compare-registry-package.mjs ') ||
          run.startsWith('node scripts/check-nuxt-registry-vue-consumer.mjs '),
      ),
    ).toHaveLength(3)
  })

  it('prevents release prepack from mutating dependency state', () => {
    const release = read('scripts/release.mjs')
    const packer = read('scripts/pack-release-tarball.mjs')

    expect(release).toContain('buildAndPackReleaseTarball(')
    expect(packer).toContain("npm_config_verify_deps_before_run: 'false'")
    expect(packer).toContain("PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'")
    expect(release).toContain('env: options.env ? { ...process.env, ...options.env } : process.env')
  })

  it('shares one build-pack path and binds locks before immutable rename', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>
    }
    const release = read('scripts/release.mjs')
    const preflight = read('scripts/prepare-candidate-app-locks.mjs')
    const sharedPreflight = read('scripts/release-preflight-tarballs.mjs')
    const updater = read('scripts/update-candidate-app-locks.mjs')

    expect(release).toContain('buildAndPackReleaseTarball(')
    expect(preflight).toContain('withReleasePreflightTarballs(')
    expect(sharedPreflight).toContain('buildAndPackReleaseTarball(')
    expect(release.indexOf('assertCandidateAppLocksBindArtifact(')).toBeLessThan(
      release.indexOf('renameSync(stagingDirectory, artifactCoordinates.directory)'),
    )
    expect(packageJson.scripts?.['update:candidate-app-locks']).toBe(
      'node scripts/prepare-candidate-app-locks.mjs update',
    )
    expect(packageJson.scripts?.['check:candidate-app-locks']).toBe(
      'node scripts/prepare-candidate-app-locks.mjs check',
    )
    expect(updater).toContain('if (options.check) {')
    expect(updater.indexOf('if (options.check) {')).toBeLessThan(
      updater.indexOf('await runPnpm(profile, validationDir, registry, false)'),
    )
  })

  it('keeps the source security job artifact-free and blocking', () => {
    const securityJob = requireJob(workflow, 'release-security')
    expect(securityJob.permissions).toEqual({
      contents: 'read',
      'security-events': 'write',
    })
    expect(
      steps(workflow, 'release-security').some((step) =>
        step.uses?.toString().startsWith('actions/download-artifact@'),
      ),
    ).toBe(false)
    expect(needs(workflow, 'build-candidates')).toContain('staging-readiness')
    expect(needs(workflow, 'staging-readiness')).toContain('release-security')
    expect(uses(workflow)).toEqual(
      expect.arrayContaining([
        'trufflesecurity/trufflehog@27b0417c16317ca9a472a9a8092acce143b49c55',
        'github/codeql-action/init@99df26d4f13ea111d4ec1a7dddef6063f76b97e9',
        'github/codeql-action/analyze@99df26d4f13ea111d4ec1a7dddef6063f76b97e9',
      ]),
    )
  })

  it('pins every action and makes every protected stage blocking', () => {
    expect(uses(workflow).every((action) => /^[^@\s]+@[0-9a-f]{40}$/u.test(action))).toBe(true)
    for (const job of Object.values(workflow.jobs ?? {})) {
      expect(job['continue-on-error']).toBeUndefined()
      expect(job.if).not.toBe('always()')
      for (const step of job.steps ?? []) {
        expect(step['continue-on-error']).toBeUndefined()
        expect(step.if).not.toBe('always()')
      }
    }
  })

  it('publishes only through three protected OIDC jobs under a run-specific tag', () => {
    const oidcJobs = Object.entries(workflow.jobs ?? {})
      .filter(([, job]) => job.permissions?.['id-token'] === 'write')
      .map(([jobId, job]) => ({ jobId, job }))
    expect(oidcJobs.map(({ jobId }) => jobId)).toEqual([
      'publish-vue-staging',
      'publish-nuxt-staging',
      'publish-mcp-staging',
    ])
    expect(oidcJobs.every(({ job }) => job.environment === 'npm')).toBe(true)
    expect(workflow.env?.BCN_CANDIDATE_DIST_TAG).toBe('candidate-${{ github.run_id }}')

    const publishRuns = oidcJobs.flatMap(({ job }) =>
      (job.steps ?? [])
        .map(normalizedRun)
        .filter((run): run is string => run?.includes('npm publish ') ?? false),
    )
    expect(publishRuns).toHaveLength(3)
    expect(
      publishRuns.every(
        (run) =>
          run.includes('--tag "$BCN_CANDIDATE_DIST_TAG"') &&
          run.includes('--ignore-scripts') &&
          run.includes('--provenance'),
      ),
    ).toBe(true)
    for (const { job } of oidcJobs) {
      expect(
        (job.steps ?? []).some((step) => step.uses?.toString().startsWith('actions/checkout@')),
      ).toBe(false)
      expect((job.steps ?? []).map(normalizedRun).join('\n')).not.toMatch(
        /pnpm|corepack|npm install|node scripts\//u,
      )
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain('LOCAL_INTEGRITY="sha512-')
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain(
        'npm view "$PACKAGE@$VERSION" dist.integrity',
      )
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain("grep -q '\\bE404\\b'")
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain(
        'cat "$REGISTRY_ERROR" >&2 exit 1',
      )
      expect(job.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
    }

    const structuredWorkflow = JSON.stringify(workflow)
    expect(structuredWorkflow).not.toContain('npm dist-tag')
    expect(structuredWorkflow).not.toContain('NODE_AUTH_TOKEN')
    expect(structuredWorkflow).not.toContain('NPM_TOKEN')

    const githubRelease = requireJob(workflow, 'github-prerelease')
    expect(githubRelease.environment).toBe('npm')
    expect(githubRelease.permissions).toEqual({ contents: 'write' })
    const githubReleaseRuns = runs(workflow, 'github-prerelease').join('\n')
    expect(githubReleaseRuns).toContain('gh release create')
    expect(githubReleaseRuns).toContain('gh release edit')
    expect(githubReleaseRuns).not.toMatch(/pnpm|npm install|node scripts\//u)
  })

  it('makes exact-host cloud staging block publication', () => {
    const staging = requireJob(workflow, 'bcn-auth-staging')
    expect(staging.environment).toBe('bcn-auth-staging')
    expect(staging.concurrency?.group).toBe('bcn-auth-staging')
    expect(staging['continue-on-error']).toBeUndefined()
    const proofStep = steps(workflow, 'bcn-auth-staging').find((step) =>
      normalizedRun(step)?.startsWith('pnpm test:auth-cloud-staging '),
    )
    if (!proofStep) throw new Error('Missing protected cloud-staging proof step')
    expect(normalizedRun(proofStep)).toContain(
      '--artifact-manifest "${{ steps.nuxt.outputs.evidence }}"',
    )
    expect(normalizedRun(proofStep)).toContain(
      '--vue-artifact-manifest "${{ steps.vue.outputs.evidence }}"',
    )
    expect(normalizedRun(proofStep)).toContain(
      '--mcp-artifact-manifest "${{ steps.mcp.outputs.evidence }}"',
    )
    expect(
      steps(workflow, 'bcn-auth-staging').some(
        (step) => step.with?.name === '${{ steps.mcp.outputs.artifact_name }}',
      ),
    ).toBe(true)
    expect(proofStep?.env).toEqual({
      BCN_AUTH_STAGING_CONVEX_SITE_URL: '${{ vars.BCN_AUTH_STAGING_CONVEX_SITE_URL }}',
      BCN_AUTH_STAGING_CONVEX_URL: '${{ vars.BCN_AUTH_STAGING_CONVEX_URL }}',
      BCN_AUTH_STAGING_EMAIL: '${{ secrets.BCN_AUTH_STAGING_EMAIL }}',
      BCN_AUTH_STAGING_INGRESS_LEASE: '${{ secrets.BCN_AUTH_STAGING_INGRESS_LEASE }}',
      BCN_AUTH_STAGING_ORIGIN: '${{ vars.BCN_AUTH_STAGING_ORIGIN }}',
      BCN_AUTH_STAGING_PASSWORD: '${{ secrets.BCN_AUTH_STAGING_PASSWORD }}',
      BCN_AUTH_STAGING_TEAM: '${{ vars.BCN_AUTH_STAGING_TEAM }}',
      CONVEX_DEPLOY_KEY: '${{ secrets.BCN_AUTH_STAGING_CONVEX_DEPLOY_KEY }}',
    })
    expect(
      steps(workflow, 'bcn-auth-staging').some(
        (step) =>
          step.with?.name === 'bcn-auth-staging-report' &&
          step.with?.path === '.release-artifacts/bcn-auth-staging.report.json',
      ),
    ).toBe(true)
    expect(
      runs(workflow, 'bcn-auth-staging').some((run) =>
        run.startsWith('node scripts/deploy-auth-staging-host.mjs '),
      ),
    ).toBe(true)
    const stagingRuns = runs(workflow, 'bcn-auth-staging')
    const deployIndex = stagingRuns.findIndex((run) =>
      run.startsWith('node scripts/deploy-auth-staging-host.mjs '),
    )
    const proofIndex = stagingRuns.findIndex((run) =>
      run.startsWith('pnpm test:auth-cloud-staging '),
    )
    expect(deployIndex).toBeGreaterThanOrEqual(0)
    expect(deployIndex).toBeLessThan(proofIndex)
    expect(stagingRuns.join('\n')).not.toContain('retention-days:')
    expect(needs(workflow, 'publish-vue-staging')).toEqual(['bcn-auth-staging'])
  })
})
