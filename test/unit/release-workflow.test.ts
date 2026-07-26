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

interface Workflow {
  jobs?: Record<string, { steps?: Array<{ run?: unknown }> }>
}

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8')
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
  return (workflow.jobs?.[jobId]?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === 'string')
    .filter((run) =>
      /release:prepare|prepare-candidate-set\.mjs (?:family|prepare)|release\.mjs prepare/u.test(
        run,
      ),
    )
}

describe('trusted prerelease workflow', () => {
  const workflow = read('.github/workflows/publish-prerelease.yml')
  const ciWorkflow = read('.github/workflows/ci.yml')
  const cloudGate = read('scripts/run-auth-cloud-staging.mjs')
  const candidateApps = read('scripts/check-candidate-apps.mjs')
  const candidateProfiles = read('scripts/maintained-candidate-apps.mjs')
  const artifactCoordinateCli = read('scripts/print-package-artifact-coordinates.mjs')
  const candidateSetCoordinateCli = read('scripts/print-candidate-set-coordinates.mjs')
  const registryComparator = read('scripts/compare-registry-package.mjs')
  const registryVueConsumer = read('scripts/check-nuxt-registry-vue-consumer.mjs')
  const releaseBuilder = read('scripts/release.mjs')
  const releaseVerify = read('scripts/verify-release.mjs')

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

  it('uses the same canonical preparation command in both parsed workflows', () => {
    const expected = ['pnpm release:prepare']
    expect(preparationCommands(parse(ciWorkflow) as Workflow, 'release-gate')).toEqual(expected)
    expect(
      preparationCommands(
        parse(read('.github/workflows/package-preview.yml')) as Workflow,
        'preview',
      ),
    ).toEqual(expected)
  })

  it('builds the closed candidate set and separate MCP artifact exactly once', () => {
    expect(workflow.match(/pnpm release:artifact:set/g)).toHaveLength(1)
    expect(workflow.match(/release\.mjs artifact --package mcp/g)).toHaveLength(1)
    expect(
      workflow.match(/name: \$\{\{ steps\.candidate_set\.outputs\.artifact_name \}\}/g),
    ).toHaveLength(6)
    expect(workflow.match(/name: \$\{\{ steps\.mcp\.outputs\.artifact_name \}\}/g)).toHaveLength(3)
    expect(workflow).toContain('${{ steps.candidate_set.outputs.vue_directory }}/')
    expect(workflow).toContain('${{ steps.candidate_set.outputs.nuxt_directory }}/')
    expect(workflow).toContain('${{ steps.candidate_set.outputs.set_directory }}/')
    expect(workflow.match(/path: \.release-artifacts\//g)).toHaveLength(1)
    expect(workflow).toContain('path: .release-artifacts/bcn-auth-staging.report.json')
    expect(workflow.match(/include-hidden-files: true/g)).toHaveLength(3)
    expect(workflow.slice(0, workflow.indexOf('  release-security:'))).toContain('fetch-depth: 0')
    expect(workflow).toContain('pnpm release:verify:set')
    expect(workflow).toContain('--package vue\n          --artifact-manifest')
    expect(workflow).toContain('--package nuxt\n          --artifact-manifest')
    expect(workflow).toContain('pnpm release:verify\n          --package mcp')
    expect(workflow.match(/node scripts\/release\.mjs verify/g)).toHaveLength(2)
    expect(artifactCoordinateCli).toContain('getPackageArtifactCoordinates(arguments_[1])')
    expect(artifactCoordinateCli).toContain(
      'artifact_name: `release-candidate-${coordinates.packageId}`',
    )
    expect(artifactCoordinateCli).toContain('directory: coordinates.relativeDirectory')
    expect(artifactCoordinateCli).toContain('tarball: coordinates.relativePaths.tarball')
    expect(candidateSetCoordinateCli).toContain("artifact_name: 'release-candidate-vue-nuxt-set'")
    expect(candidateSetCoordinateCli).toContain('candidateSetPackageIds.map')
    expect(registryComparator).toContain('readFileSync(registryTarball).equals(')
    expect(registryComparator).toContain('readFileSync(coordinates.paths.tarball)')
    expect(registryVueConsumer).toContain('assertCandidateSetManifest')
    expect(registryVueConsumer).toContain('https://registry.npmjs.org/')
    expect(workflow).not.toContain('`v${pkg.version}.artifact.json`')
    expect(workflow).not.toContain('`${pkg.name}-${pkg.version}.tgz`')
    expect(workflow).not.toContain('value.tarball.file')
    expect(read('scripts/verify-release.mjs')).toContain("'scripts/check-candidate-apps.mjs',")
    expect(read('scripts/verify-release.mjs')).toContain("'--package',\n    releasePackageId,")
    expect(read('scripts/verify-release.mjs')).toContain("'--tarball',\n    tarball,")
    expect(releaseVerify).toContain('Source-integrity and source-runtime behavior gates')
    expect(releaseVerify).toContain('Artifact-dependent package and consumer gates')
    expect(releaseVerify).toContain('source gates ran from the checkout')
    expect(releaseVerify).toContain("CONVEX_E2E_AUTO_START: 'true'")
    expect(releaseVerify).toContain("BCN_E2E_REQUIRE_LOCAL: 'true'")
    expect(releaseVerify).toContain('BCN_RELEASE_TARBALL: tarball')
    expect(releaseVerify).toContain('BCN_RELEASE_VUE_TARBALL: vueCoordinates.paths.tarball')
    expect(releaseVerify).toContain("const mcpCoordinates = verifyRetainedCompanionArtifact('mcp')")
    expect(releaseVerify).toContain("'--mcp-tarball',\n    mcpCoordinates.paths.tarball")
    expect(candidateApps).toContain('prepareFixtureCompanionCandidate(')
    expect(candidateApps).toContain('manifest.dependencies[packageName] =')
    const authSchema = read('scripts/check-auth-schema.mjs')
    expect(authSchema).toContain('process.env.BCN_RELEASE_VUE_TARBALL')
    expect(authSchema).toContain("'better-convex-vue': 'file:./better-convex-vue.tgz'")
    expect(releaseVerify).not.toContain('every release suite')
    expect(workflow).not.toContain('npm publish .')
  })

  it('does not transfer an artifact into the source-only security job', () => {
    const releaseSecurityJob = workflow.slice(
      workflow.indexOf('  release-security:'),
      workflow.indexOf('  verify-candidates:'),
    )

    expect(releaseSecurityJob).not.toContain('actions/download-artifact')
    expect(releaseSecurityJob).not.toContain('.release-artifacts')
  })

  it('accepts only the reviewed Nuxt artifact coordinate in the release verifier', () => {
    expect(releaseVerify).toContain(
      "import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'",
    )
    expect(releaseVerify).toContain("const releasePackageId = values.get('--package') ?? 'nuxt'")
    expect(releaseVerify).toContain("releasePackageId === 'vue' || releasePackageId === 'mcp'")
    expect(releaseVerify).toContain("'--package',\n      releasePackageId")
    expect(releaseVerify).toContain('getPackageArtifactCoordinates(releasePackageId')
    expect(releaseVerify).toContain('evidencePath !== artifactCoordinates.paths.evidence')
    expect(releaseVerify).toContain('artifactCoordinates.relativePaths.evidence')
    expect(releaseVerify).toContain('const tarball = artifactCoordinates.paths.tarball')
    expect(releaseVerify).not.toContain('readFileSync(evidencePath')

    const rejected = spawnSync(
      process.execPath,
      ['scripts/verify-release.mjs', '--artifact-manifest', 'unreviewed/artifact.json'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain(
      'artifact manifest must be the reviewed nuxt coordinate: .release-artifacts/nuxt/',
    )
  })

  it('commits one package artifact atomically without deleting sibling packages', () => {
    expect(releaseBuilder).toContain('renameSync(stagingDirectory, artifactCoordinates.directory)')
    expect(releaseBuilder).toContain(
      'if (!committed) rmSync(stagingDirectory, { force: true, recursive: true })',
    )
    expect(releaseBuilder).not.toContain('rmSync(artifactsDir')
    expect(releaseBuilder).not.toMatch(
      /rmSync\(artifactCoordinates\.(?:artifactRoot|packageArtifactDirectory)/u,
    )
    expect(releaseBuilder).toContain('assertReleaseTagIsUnusedOrCurrent(sourceCommit)')
    expect(releaseBuilder).toContain(
      'Release artifact creation requires complete Git history and tags',
    )
    expect(releaseBuilder).toContain('bump the package version before creating another artifact')
  })

  it('binds evidence identity to committed package-manifest bytes', () => {
    expect(releaseBuilder).toContain(
      'assertPackageManifestMatchesCommit(releasePackageId, currentCommit)',
    )
    expect(releaseBuilder).toContain('assertPackageArtifactBuildIdentity(evidence, {')
    expect(releaseBuilder).toContain('packageManager: workspacePackageManager')
    expect(releaseBuilder).toContain(
      "throw new Error('Release source commit changed while creating the artifact.')",
    )
  })

  it('installs the exact candidate into a pinned npm consumer and compares installed bytes', () => {
    expect(candidateApps).toContain(
      "run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']",
    )
    expect(candidateApps).toContain("join(appDir, 'package-lock.json')")
    expect(candidateProfiles).toContain("tarballFilename: 'better-convex-nuxt.tgz'")
    expect(candidateApps).toContain('lock.includes(candidateProfile.tarballFilename)')
    expect(candidateApps).toContain('packageFingerprint(installedPackageDir)')
    expect(candidateApps).toContain("run('npm', ['run', 'typecheck']")
    expect(candidateApps).toContain("run('npm', ['run', 'build']")
  })

  it('uses exact release tooling and commit-pinned artifact actions', () => {
    expect(workflow).toContain("RELEASE_NODE_VERSION: '22.14.0'")
    expect(workflow).toContain("RELEASE_NPM_VERSION: '11.5.1'")
    expect(workflow.match(/corepack@0\.34\.5 && corepack enable/g)).toHaveLength(7)
    expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
    expect(workflow).toContain('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c')
    expect(workflow).not.toMatch(/uses:\s+\S+@v\d/u)
  })

  it('gives the full release graph its verified 120-minute CI budget', () => {
    const releaseGate = ciWorkflow.slice(ciWorkflow.indexOf('  release-gate:'))
    expect(releaseGate).toContain('timeout-minutes: 120')
    expect(releaseGate).toContain('fetch-depth: 0')
  })

  it('builds current package exports before standalone real-backend E2E', () => {
    const runner = read('scripts/run-e2e.mjs')
    const prepare = runner.indexOf("run('pnpm', ['exec', 'nuxt-module-build', 'prepare'])")
    const build = runner.indexOf("run('pnpm', ['exec', 'nuxt-module-build', 'build'])")

    expect(prepare).toBeGreaterThan(-1)
    expect(prepare).toBeLessThan(build)
    expect(build).toBeLessThan(runner.indexOf('for (const file of files)'))
  })

  it('gates the artifact verification chain on release-ref secret and CodeQL scans', () => {
    expect(workflow).toContain('release-security:')
    expect(workflow).toContain('needs: [build-candidates, release-security]')
    expect(workflow).toContain(
      'trufflesecurity/trufflehog@27b0417c16317ca9a472a9a8092acce143b49c55',
    )
    expect(workflow).toContain('github/codeql-action/init@99df26d4f13ea111d4ec1a7dddef6063f76b97e9')
    expect(workflow).toContain(
      'github/codeql-action/analyze@99df26d4f13ea111d4ec1a7dddef6063f76b97e9',
    )
    expect(workflow.match(/security-events: write/g)).toHaveLength(1)
  })

  it('publishes in dependency order under a non-default staging tag and stops before promotion', () => {
    expect(workflow.match(/id-token: write/g)).toHaveLength(3)
    expect(workflow.match(/environment: npm-release/g)).toHaveLength(3)
    expect(workflow.match(/--tag "\$BCN_STAGING_DIST_TAG"/g)).toHaveLength(3)
    expect(workflow.match(/NPM_CONFIG_PROVENANCE: 'true'/g)).toHaveLength(3)
    expect(workflow).toContain("BCN_STAGING_DIST_TAG: 'next-staging'")
    expect(workflow).toContain('needs: publish-vue-staging')
    expect(workflow).toContain('needs: registry-vue-nuxt-gate')
    expect(workflow).toContain('needs: publish-nuxt-staging')
    expect(workflow).toContain('check-nuxt-registry-vue-consumer.mjs')
    expect(workflow.match(/compare-registry-package\.mjs --package/g)).toHaveLength(3)
    expect(workflow).toContain('trusted-publishing OIDC cannot mutate dist-tags')
    expect(workflow).not.toContain('npm dist-tag')
    expect(workflow).not.toContain('--tag latest')
    expect(workflow).not.toContain('--tag next\n')
    expect(workflow).not.toContain('NODE_AUTH_TOKEN')
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(workflow).not.toContain('npm-token')
  })

  it('rejects path-selected registry verification before making a network request', () => {
    const registryConsumerRejected = spawnSync(
      process.execPath,
      [
        'scripts/check-nuxt-registry-vue-consumer.mjs',
        '--artifact-set',
        '../unreviewed/artifact-set.json',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(registryConsumerRejected.status).toBe(1)
    expect(registryConsumerRejected.stderr).toContain(
      'Candidate-set manifest is not at the reviewed artifact coordinate',
    )

    const comparatorRejected = spawnSync(
      process.execPath,
      ['scripts/compare-registry-package.mjs', '--package', 'unreviewed'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(comparatorRejected.status).toBe(1)
    expect(comparatorRejected.stderr).toContain('Unknown package certification descriptor')
  })

  it('blocks publication on the protected named cloud-staging report', () => {
    expect(workflow).toContain('bcn-auth-staging:')
    expect(workflow).toContain('environment: bcn-auth-staging')
    expect(workflow).toContain('group: bcn-auth-staging')
    expect(workflow).toContain('needs: [verify-candidates, bcn-auth-staging]')
    expect(workflow).toContain('pnpm test:auth-cloud-staging')
    expect(workflow).not.toContain('pnpm test:auth-cloud-staging --\n')
    expect(workflow).toContain(
      'CONVEX_DEPLOY_KEY: ${{ secrets.BCN_AUTH_STAGING_CONVEX_DEPLOY_KEY }}',
    )
    expect(workflow).toContain('BCN_AUTH_STAGING_TEAM: ${{ vars.BCN_AUTH_STAGING_TEAM }}')
    expect(workflow.match(/BCN_AUTH_STAGING_CONVEX_DEPLOY_KEY/g)).toHaveLength(1)
    expect(workflow.match(/^\s+BCN_AUTH_STAGING_EMAIL:/gmu)).toHaveLength(1)
    expect(workflow.match(/^\s+BCN_AUTH_STAGING_INGRESS_LEASE:/gmu)).toHaveLength(1)
    expect(workflow.match(/^\s+BCN_AUTH_STAGING_PASSWORD:/gmu)).toHaveLength(1)
    expect(workflow).toContain(
      'Install and deploy the exact candidate, then run protected cloud-staging races',
    )
    expect(workflow).toContain('name: bcn-auth-staging-report')
    expect(workflow).toContain('path: .release-artifacts/bcn-auth-staging.report.json')
    expect(cloudGate).toContain("fixturePackage.dependencies['better-convex-nuxt'] =")
    expect(cloudGate).toContain('artifact.tarballPath')
    expect(cloudGate).toContain("'deploy',")
    expect(cloudGate).toContain('normalizeCloudPrewriteProof(prewriteProof, expectedProof)')
    expect(cloudGate).toContain('closedIngressProved: true')
    expect(cloudGate).toContain('acceptedByConvex: true')
    expect(cloudGate).toContain('authProxyFingerprintMatched: true')
    expect(cloudGate).toContain('mcpResourceChallengeVerified: true')
    expect(cloudGate).toContain("'AUTH_CLOUD_STAGING_POST_CLEANUP_STATE_NOT_EMPTY'")
    expect(cloudGate).toContain('await client.mutation(releaseProofFunctions.cleanup, {})')
    expect(cloudGate).not.toContain('process.env.BCN_RELEASE_')
    expect(workflow).not.toContain('BCN_RELEASE_ARTIFACT_SHA256')
    expect(workflow).not.toContain('preview-create')
    expect(workflow).not.toContain('continue-on-error: true')
    expect(workflow).not.toContain('if: always()')
  })

  it('blocks unnamed governance and stable versions', () => {
    expect(workflow).toContain('BCN_SECURITY_OWNER')
    expect(workflow).toContain('BCN_SECURITY_DEPUTY')
    expect(workflow).toContain('BCN_SECURITY_NOTIFICATION_TESTED_AT')
    expect(workflow).toContain('pnpm check:security-governance --prerelease')
    expect(read('scripts/check-security-governance.mjs')).toContain("!packageVersion.includes('-')")
  })

  it('passes script options directly under the pinned pnpm CLI', () => {
    const sources = [
      workflow,
      read('.github/workflows/ci.yml'),
      read('.github/workflows/security-extended.yml'),
      read('package.json'),
      read('scripts/release.mjs'),
      read('scripts/verify-release.mjs'),
      read('RELEASING.md'),
      read('test/TESTING.md'),
    ].join('\n')

    expect(sources).not.toMatch(/pnpm [^\n]* -- --[\w-]+/u)
    expect(sources).not.toMatch(/pnpm [^\n]* --\n\s+--[\w-]+/u)
  })

  it('keeps workstation instructions non-publishing', () => {
    const instructions = read('RELEASING.md')
    expect(instructions).toContain('must never publish')
    expect(instructions).toMatch(/Require two-factor authentication and disallow\s+tokens/u)
    expect(instructions).not.toMatch(/^npm publish /mu)
    expect(instructions).not.toMatch(/^pnpm publish /mu)
    expect(instructions).not.toMatch(/^npm dist-tag /mu)
  })
})
