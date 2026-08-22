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
  'CHANGELOG.md',
  'package.json',
  'packages/mcp/package.json',
  'packages/vue/package.json',
  'scripts/package-artifact-coordinates.mjs',
  'scripts/package-artifact-evidence.mjs',
  'scripts/package-candidate-set.mjs',
  'scripts/package-certification-manifest.mjs',
  'scripts/package-runtime-fingerprint-profile.mjs',
  'scripts/prepare-candidate-set.mjs',
  'scripts/release-changelog.mjs',
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
  'working-directory'?: unknown
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
  on?: Record<string, unknown>
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

  it('certifies pull requests against every base branch for stacked delivery', () => {
    expect(ciWorkflow.on?.push).toEqual({ branches: ['main'] })
    expect(ciWorkflow.on?.pull_request).toBeNull()
  })

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
          'scripts/verify-release.mjs --package vue --artifact-manifest .release-artifacts/vue/1.0.0-beta.1/artifact.json',
          'scripts/verify-release.mjs --package nuxt --artifact-manifest .release-artifacts/nuxt/1.0.0-beta.1/artifact.json',
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

  it('rejects unreviewed verifier coordinates before network work', () => {
    const verifier = spawnSync(
      process.execPath,
      ['scripts/verify-release.mjs', '--artifact-manifest', 'unreviewed/artifact.json'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(verifier.status).toBe(1)
    expect(verifier.stderr).toContain(
      'artifact manifest must be the reviewed nuxt coordinate: .release-artifacts/nuxt/',
    )
  })

  it('keeps CI source-only and package previews non-authoritative', async () => {
    expect(ciWorkflow.env?.RELEASE_NPM_VERSION).toBe('11.18.0')
    expect(preparationCommands(ciWorkflow, 'release-gate')).toEqual([])
    expect(preparationCommands(previewWorkflow, 'preview')).toEqual([])
    expect(runs(previewWorkflow, 'preview')).toContain('node scripts/build-package-preview.mjs')
    expect(runs(ciWorkflow, 'release-smoke')).toContain('pnpm release:smoke')
    expect(runs(ciWorkflow, 'release-smoke')).toContain(
      'npm install --global npm@"$RELEASE_NPM_VERSION" corepack@0.34.5 && corepack enable',
    )
    expect(
      steps(ciWorkflow, 'release-smoke').find(
        (step) => step.name === 'Retain the Linux candidate locks for review',
      ),
    ).toMatchObject({
      if: 'failure()',
      uses: 'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
    })
    expect(requireJob(ciWorkflow, 'release-gate')['timeout-minutes']).toBe(5)
    expect(needs(ciWorkflow, 'release-gate')).toEqual([
      'classify',
      'secrets',
      'compatibility',
      'auth-contracts',
      'auth-real-backend',
      'deployable-app-audits',
      'release-smoke',
    ])
    expect(runs(ciWorkflow, 'release-gate')).toEqual([
      'test "$CLASSIFY_RESULT" = success case "$FULL" in true | false) ;; *) echo "Invalid classifier output: $FULL" >&2; exit 1 ;; esac test "$SECRETS" = success test "$DEPLOYABLE_APP_AUDITS" = success for result in "$COMPATIBILITY" "$AUTH_CONTRACTS" "$AUTH_REAL_BACKEND" "$RELEASE_SMOKE"; do if [ "$FULL" = true ]; then test "$result" = success; else test "$result" = skipped; fi done',
    ])
    const classifyScript = steps(ciWorkflow, 'classify').find(
      (step) => step.name === 'Select required lanes',
    )?.with?.script
    if (typeof classifyScript !== 'string') throw new Error('Missing CI classifier script.')
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<void>
    for (const scenario of [
      {
        name: 'public docs',
        event: 'pull_request',
        paths: ['docs/content/1.index.md'],
        full: 'false',
      },
      {
        name: 'package source',
        event: 'pull_request',
        paths: ['packages/vue/src/index.ts'],
        full: 'true',
      },
      {
        name: 'empty pull request',
        event: 'pull_request',
        paths: [],
        full: 'true',
      },
      {
        name: 'mixed public docs and source',
        event: 'pull_request',
        paths: ['docs/content/1.index.md', 'packages/vue/src/index.ts'],
        full: 'true',
      },
      {
        name: 'workflow policy',
        event: 'pull_request',
        paths: ['.github/workflows/ci.yml'],
        full: 'true',
      },
      { name: 'main certification', event: 'push', paths: [], full: 'true' },
    ]) {
      const outputs = new Map<string, string>()
      await new AsyncFunction('context', 'github', 'core', classifyScript)(
        {
          eventName: scenario.event,
          issue: { number: 1 },
          repo: { owner: 'lupinum-dev', repo: 'better-convex' },
        },
        {
          paginate: async () => scenario.paths.map((filename) => ({ filename })),
          rest: { pulls: { listFiles() {} } },
        },
        { setOutput: (name: string, value: string) => outputs.set(name, value) },
      )
      expect(outputs.get('full'), scenario.name).toBe(scenario.full)
    }
  })

  it('installs the independent documentation workspace before core certification', () => {
    const documentationInstall = steps(ciWorkflow, 'compatibility').find(
      (step) => step.name === 'Install documentation dependencies',
    )
    expect(documentationInstall).toMatchObject({
      'working-directory': 'docs',
      run: 'corepack pnpm install --frozen-lockfile --ignore-scripts',
    })
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
      'build-candidates': ['release-security'],
      'verify-candidates': ['build-candidates'],
      'publish-packages': ['verify-candidates'],
      'github-prerelease': ['publish-packages'],
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
    expect(needs(workflow, 'build-candidates')).toEqual(['release-security'])
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
    const verifyRuns = runs(workflow, 'verify-candidates')
    const orderedVerificationRuns = [
      'pnpm exec playwright install --with-deps chromium',
      'pnpm check:auth-backend --install',
      'pnpm release:verify:set "${{ steps.candidate_set.outputs.evidence }}"',
      'pnpm release:verify --package vue --artifact-manifest "${{ steps.vue.outputs.evidence }}"',
      'pnpm release:verify --package nuxt --artifact-manifest "${{ steps.nuxt.outputs.evidence }}"',
      'pnpm release:verify --package mcp --artifact-manifest "${{ steps.mcp.outputs.evidence }}"',
    ]
    const verificationIndexes = orderedVerificationRuns.map((run) => verifyRuns.indexOf(run))
    expect(verificationIndexes.every((index) => index >= 0)).toBe(true)
    expect(verificationIndexes).toEqual(
      [...verificationIndexes].sort((left, right) => left - right),
    )
    const candidateSetVerifier = readFileSync(
      join(root, 'scripts/prepare-candidate-set.mjs'),
      'utf8',
    )
    expect(candidateSetVerifier).toContain(
      'Release metadata does not match the reviewed candidate set.',
    )
    expect(
      candidateSetVerifier.indexOf("join(dirname(resolve(root, manifest)), 'release.json')"),
    ).toBeLessThan(candidateSetVerifier.indexOf('for (const entry of evidence.packages)'))
  })

  it('retries post-mint work against transferred bytes without rebuilding', () => {
    const postMintJobs = ['verify-candidates', 'publish-packages', 'github-prerelease']
    const postMintRuns = postMintJobs.flatMap((jobId) => runs(workflow, jobId))
    expect(postMintRuns.join('\n')).not.toMatch(
      /release:artifact|prepare-candidate-set\.mjs|release\.mjs artifact/u,
    )
    expect(
      steps(workflow, 'verify-candidates')
        .filter((step) => step.uses?.toString().startsWith('actions/download-artifact@'))
        .map((step) => step.with?.name),
    ).toEqual([
      '${{ steps.candidate_set.outputs.artifact_name }}',
      '${{ steps.mcp.outputs.artifact_name }}',
    ])
    expect(postMintRuns.join('\n')).not.toContain('node scripts/compare-registry-package.mjs')
    expect(postMintRuns.join('\n')).not.toContain(
      'node scripts/check-nuxt-registry-vue-consumer.mjs',
    )
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
    expect(updater).toContain('createCandidateRegistryMetadata({ ...candidate, registry })')
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
    expect(needs(workflow, 'build-candidates')).toEqual(['release-security'])
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

  it('publishes the complete set through one protected OIDC job under next', () => {
    expect(workflow.on).toEqual({
      workflow_dispatch: {
        inputs: {
          bootstrap_packages: {
            description:
              'Comma-separated packages explicitly authorized for first-version bootstrap recovery',
            required: false,
            default: '',
            type: 'string',
          },
          version: {
            description: 'Exact Nuxt and Vue prerelease version',
            required: true,
            type: 'string',
          },
        },
      },
    })
    const oidcJobs = Object.entries(workflow.jobs ?? {})
      .filter(([, job]) => job.permissions?.['id-token'] === 'write')
      .map(([jobId, job]) => ({ jobId, job }))
    expect(oidcJobs.map(({ jobId }) => jobId)).toEqual(['publish-packages'])
    expect(oidcJobs.every(({ job }) => job.environment === 'npm')).toBe(true)
    expect(workflow.env?.BCN_RELEASE_DIST_TAG).toBe('next')

    const publishRuns = oidcJobs.flatMap(({ job }) =>
      (job.steps ?? [])
        .map(normalizedRun)
        .filter((run): run is string => run?.includes("'publish', candidate.tarball") ?? false),
    )
    expect(publishRuns).toHaveLength(1)
    expect(publishRuns[0]).toContain('process.env.BCN_RELEASE_DIST_TAG')
    expect(publishRuns[0]).toContain("'--ignore-scripts', '--provenance'")
    for (const { job } of oidcJobs) {
      expect(
        (job.steps ?? []).some((step) => step.uses?.toString().startsWith('actions/checkout@')),
      ).toBe(false)
      expect((job.steps ?? []).map(normalizedRun).join('\n')).not.toMatch(
        /pnpm|corepack|npm install|node scripts\//u,
      )
      expect(
        (job.steps ?? []).filter((step) =>
          step.uses?.toString().startsWith('actions/download-artifact@'),
        ),
      ).toHaveLength(2)
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain(
        "createHash('sha512').update(bytes)",
      )
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain(
        "view(spec, 'dist.integrity')",
      )
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain(
        "view(spec, 'dist.attestations')",
      )
      expect((job.steps ?? []).map(normalizedRun).join('\n')).toContain('versions.length !== 1')
      const rawPublishRun = (job.steps ?? []).find(
        (step) => typeof step.run === 'string' && step.run.includes("'publish', candidate.tarball"),
      )?.run
      expect(rawPublishRun).toBeTypeOf('string')
      expect(rawPublishRun).toContain('npm view failed for')
      expect(job.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
    }

    const structuredWorkflow = JSON.stringify(workflow)
    expect(structuredWorkflow).not.toContain('npm dist-tag')
    expect(structuredWorkflow).not.toContain('NODE_AUTH_TOKEN')
    expect(structuredWorkflow).not.toContain('NPM_TOKEN')

    const githubRelease = requireJob(workflow, 'github-prerelease')
    expect(githubRelease.environment).toBeUndefined()
    expect(githubRelease.permissions).toEqual({
      actions: 'read',
      contents: 'write',
    })
    expect(
      steps(workflow, 'github-prerelease').some((step) =>
        step.uses?.toString().startsWith('actions/checkout@'),
      ),
    ).toBe(false)
    expect(
      steps(workflow, 'github-prerelease').filter((step) =>
        step.uses?.toString().startsWith('actions/download-artifact@'),
      ),
    ).toHaveLength(2)
    const githubReleaseRuns = runs(workflow, 'github-prerelease').join('\n')
    expect(githubReleaseRuns).toContain('gh release create')
    expect(githubReleaseRuns).toContain('--target "$GITHUB_SHA"')
    expect(githubReleaseRuns).toContain('gh release edit')
    expect(githubReleaseRuns).toContain('gh release upload')
    expect(githubReleaseRuns).toContain('release_assets')
    expect(githubReleaseRuns).toContain('vue-nuxt-artifact-set.json')
    expect(githubReleaseRuns).toContain("-name 'release.json'")
    expect(githubReleaseRuns).toContain('"$RUNNER_TEMP/release.json"')
    expect(githubReleaseRuns).toContain('mcp_evidence=".release-artifacts/artifact.json"')
    expect(githubReleaseRuns).toContain('test -f "$mcp_evidence"')
    expect(githubReleaseRuns).toContain('git/ref/tags/$TAG')
    expect(githubReleaseRuns).toContain('test "$tag_sha" = "$GITHUB_SHA"')
    expect(githubReleaseRuns).toContain(
      'This first npm version was created from the exact CI-certified artifact',
    )
    expect(githubReleaseRuns).not.toMatch(/pnpm|npm install|node scripts\//u)
  })
})
