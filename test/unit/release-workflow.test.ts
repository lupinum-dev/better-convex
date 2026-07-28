import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
    const executionLog = join(temporaryDirectory, 'executed.log')
    writeFileSync(fakeNode, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$BCN_RELEASE_FAMILY_TEST_LOG"\n')
    chmodSync(fakeNode, 0o755)

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
      expect(readFileSync(executionLog, 'utf8').trim().split('\n')).toEqual([
        'scripts/release.mjs prepare --package mcp',
        'scripts/prepare-candidate-set.mjs prepare',
      ])
      expect(existsSync(join(repository, '.release-artifacts'))).toBe(false)
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
      ['scripts/publish-registry-package.mjs', '--package', 'unreviewed', '--tag', 'next-staging'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(publisher.status).toBe(1)
    expect(publisher.stderr).toContain('Unknown package certification descriptor')
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
        ['scripts/publish-registry-package.mjs', '--package', 'vue', '--tag', 'next-staging'],
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
        `publish ${resolve(root, `.release-artifacts/vue/${version}/better-convex-vue-${version}.tgz`)} --tag next-staging --access public --registry https://registry.npmjs.org`,
      )
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('uses the one canonical preparation command in CI and preview workflows', () => {
    expect(preparationCommands(ciWorkflow, 'release-gate')).toEqual(['pnpm release:prepare'])
    expect(preparationCommands(previewWorkflow, 'preview')).toEqual(['pnpm release:prepare'])
    expect(requireJob(ciWorkflow, 'release-gate')['timeout-minutes']).toBe(120)
    expect(steps(ciWorkflow, 'release-gate')[0]?.with?.['fetch-depth']).toBe(0)
  })

  it('models the exact blocking publication DAG', () => {
    expect(
      Object.fromEntries(
        Object.keys(workflow.jobs ?? {}).map((jobId) => [jobId, needs(workflow, jobId)]),
      ),
    ).toEqual({
      'build-candidates': [],
      'release-security': ['build-candidates'],
      'verify-candidates': ['build-candidates', 'release-security'],
      'bcn-auth-staging': ['verify-candidates'],
      'publish-vue-staging': ['verify-candidates', 'bcn-auth-staging'],
      'registry-vue-nuxt-gate': ['publish-vue-staging'],
      'publish-nuxt-staging': ['registry-vue-nuxt-gate'],
      'publish-mcp-staging': ['publish-nuxt-staging'],
      'staged-candidate-set-complete': [
        'publish-vue-staging',
        'registry-vue-nuxt-gate',
        'publish-nuxt-staging',
        'publish-mcp-staging',
      ],
    })
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
    expect(needs(workflow, 'verify-candidates')).toContain('release-security')
    expect(uses(workflow)).toEqual(
      expect.arrayContaining([
        'trufflesecurity/trufflehog@27b0417c16317ca9a472a9a8092acce143b49c55',
        'github/codeql-action/init@99df26d4f13ea111d4ec1a7dddef6063f76b97e9',
        'github/codeql-action/analyze@99df26d4f13ea111d4ec1a7dddef6063f76b97e9',
      ]),
    )
  })

  it('pins every action and has no non-blocking workflow escape hatch', () => {
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

  it('publishes only through three protected OIDC jobs under the staging tag', () => {
    const oidcJobs = Object.entries(workflow.jobs ?? {})
      .filter(([, job]) => job.permissions?.['id-token'] === 'write')
      .map(([jobId, job]) => ({ jobId, job }))
    expect(oidcJobs.map(({ jobId }) => jobId)).toEqual([
      'publish-vue-staging',
      'publish-nuxt-staging',
      'publish-mcp-staging',
    ])
    expect(oidcJobs.every(({ job }) => job.environment === 'npm-release')).toBe(true)
    expect(workflow.env?.BCN_STAGING_DIST_TAG).toBe('next-staging')

    const publishRuns = oidcJobs.flatMap(({ job }) =>
      (job.steps ?? [])
        .map(normalizedRun)
        .filter(
          (run): run is string =>
            run?.startsWith('node scripts/publish-registry-package.mjs ') ?? false,
        ),
    )
    expect(publishRuns).toHaveLength(3)
    expect(
      publishRuns.every(
        (run) => run.includes('--package ') && run.includes('--tag "$BCN_STAGING_DIST_TAG"'),
      ),
    ).toBe(true)

    const structuredWorkflow = JSON.stringify(workflow)
    expect(structuredWorkflow).not.toContain('npm dist-tag')
    expect(structuredWorkflow).not.toContain('NODE_AUTH_TOKEN')
    expect(structuredWorkflow).not.toContain('NPM_TOKEN')
  })

  it('binds protected cloud staging and its report before publication', () => {
    const staging = requireJob(workflow, 'bcn-auth-staging')
    expect(staging.environment).toBe('bcn-auth-staging')
    expect(staging.concurrency?.group).toBe('bcn-auth-staging')
    const proofStep = steps(workflow, 'bcn-auth-staging').find((step) =>
      normalizedRun(step)?.startsWith('pnpm test:auth-cloud-staging '),
    )
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
    expect(needs(workflow, 'publish-vue-staging')).toContain('bcn-auth-staging')
  })
})
