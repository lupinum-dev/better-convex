import assert from 'node:assert/strict'

import {
  assertFreshFirstAttempt,
  classifyReconciliation,
  evaluateProvenanceStatement,
  isFirstPublicationAttempt,
  releaseAssetFiles,
  releaseMetadataState,
} from './reconcile-release.mjs'
import {
  classifyCandidateNeed,
  classifyReleaseIntent,
  detectReleaseIntents,
  releaseUnits,
  selectIncompleteIntent,
} from './release-intent.mjs'

const versions = {
  workspaceVersion: '1.0.0-beta.1',
  vueVersion: '1.0.0-beta.1',
  mcpVersion: '0.4.0',
}
const units = releaseUnits(versions)
assert.deepEqual(
  units.map((unit) => [unit.id, unit.tag, unit.channel]),
  [
    ['vue-nuxt', 'v1.0.0-beta.1', 'next'],
    ['mcp', 'mcp-v0.4.0', 'latest'],
  ],
)
assert.deepEqual(detectReleaseIntents('# Changelog\n', versions), [])
assert.deepEqual(
  detectReleaseIntents('## v1.0.0-beta.1\n', versions).map((unit) => unit.id),
  ['vue-nuxt'],
)
assert.deepEqual(
  detectReleaseIntents('## mcp-v0.4.0\n', versions).map((unit) => unit.id),
  ['mcp'],
)
assert.equal(detectReleaseIntents('## v1.0.0-beta.10\n', versions).length, 0)
assert.equal(detectReleaseIntents('## v1.0.0-beta.1\n## mcp-v0.4.0\n', versions).length, 2)
assert.throws(
  () => releaseUnits({ ...versions, vueVersion: '1.0.0-beta.2' }),
  /must remain coupled/u,
)
assert.equal(isFirstPublicationAttempt('publish', ['absent', 'absent']), true)
assert.equal(isFirstPublicationAttempt('publish', ['oidc', 'absent']), false)
assert.equal(isFirstPublicationAttempt('repair', ['oidc', 'oidc']), false)
assert.equal(classifyCandidateNeed([null, null]), 'build')
assert.equal(classifyCandidateNeed(['sha', 'sha']), 'reuse')
assert.equal(classifyCandidateNeed(['sha', null]), 'partial')
assert.equal(
  classifyReleaseIntent({ publications: [null, null], tag: 'absent', release: 'absent' }),
  'build',
)

assert.deepEqual(
  releaseAssetFiles({
    assets: [{ file: 'package.tgz' }, { file: 'artifact.json' }],
  }),
  ['artifact.json', 'github-release-notes.md', 'package.tgz', 'release-record.json'],
)
assert.equal(
  classifyReleaseIntent({ publications: ['sha', 'sha'], tag: 'absent', release: 'absent' }),
  'repair',
)
assert.equal(
  classifyReleaseIntent({ publications: ['sha', 'sha'], tag: 'present', release: 'present' }),
  'verify',
)
assert.equal(
  classifyReleaseIntent({ publications: ['sha', null], tag: 'absent', release: 'absent' }),
  'repair',
)
assert.throws(
  () => classifyReleaseIntent({ publications: [null, null], tag: 'present', release: 'absent' }),
  /before npm publication/u,
)

const [vueNuxt, mcp] = units
assert.equal(
  selectIncompleteIntent([
    { intent: vueNuxt, state: 'complete' },
    { intent: mcp, state: 'build' },
  ]).intent.id,
  'mcp',
)
assert.equal(selectIncompleteIntent([{ intent: vueNuxt, state: 'complete' }]), undefined)
assert.throws(
  () =>
    selectIncompleteIntent([
      { intent: vueNuxt, state: 'repair' },
      { intent: mcp, state: 'build' },
    ]),
  /Multiple incomplete release intents/u,
)

const complete = {
  modes: ['oidc', 'oidc'],
  tag: 'verified',
  release: 'present',
  assets: 'verified',
  metadata: 'verified',
}
assert.equal(classifyReconciliation(complete), 'complete')
assert.equal(
  classifyReconciliation({ ...complete, release: 'absent', assets: 'absent', metadata: 'absent' }),
  'repair',
)
assert.equal(classifyReconciliation({ ...complete, metadata: 'conflict' }), 'repair')
assert.equal(
  classifyReconciliation({
    ...complete,
    modes: ['absent', 'oidc'],
    tag: 'absent',
    release: 'absent',
    assets: 'absent',
    metadata: 'absent',
  }),
  'publish',
)
assert.throws(() => classifyReconciliation({ ...complete, tag: 'conflict' }), /different commit/u)
assert.throws(
  () => classifyReconciliation({ ...complete, modes: ['absent', 'oidc'] }),
  /before npm publication/u,
)

assert.throws(
  () =>
    assertFreshFirstAttempt({
      action: 'publish',
      firstAttempt: true,
      mainSha: 'b'.repeat(40),
      sourceSha: 'a'.repeat(40),
    }),
  /stale/u,
)
assert.doesNotThrow(() =>
  assertFreshFirstAttempt({
    action: 'publish',
    firstAttempt: false,
    mainSha: 'b'.repeat(40),
    sourceSha: 'a'.repeat(40),
  }),
)

const releaseRecord = {
  title: 'Better Convex v1.0.0-beta.1',
  notes: 'Certified notes',
  channel: 'next',
}
assert.equal(
  releaseMetadataState(
    { name: releaseRecord.title, body: 'Certified notes\n', isPrerelease: true },
    releaseRecord,
  ),
  'verified',
)
assert.equal(
  releaseMetadataState(
    { name: 'stale', body: 'Certified notes\n', isPrerelease: true },
    releaseRecord,
  ),
  'conflict',
)
assert.equal(
  releaseMetadataState(
    { name: releaseRecord.title, body: 'stale notes', isPrerelease: true },
    releaseRecord,
  ),
  'conflict',
)

const sourceSha = 'a'.repeat(40)
const provenanceIntegrity = `sha512-${Buffer.from('ab'.repeat(64), 'hex').toString('base64')}`
const provenance = {
  predicateType: 'https://slsa.dev/provenance/v1',
  subject: [
    {
      name: 'pkg:npm/%40lupinum/better-convex-vue@1.0.0-beta.1',
      digest: { sha512: 'ab'.repeat(64) },
    },
  ],
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          repository: 'https://github.com/lupinum-dev/better-convex',
          ref: 'refs/heads/main',
          path: '.github/workflows/publish-prerelease.yml',
        },
      },
      resolvedDependencies: [
        {
          uri: 'git+https://github.com/lupinum-dev/better-convex@refs/heads/main',
          digest: { gitCommit: sourceSha },
        },
      ],
    },
  },
}
const provenancePackage = { name: '@lupinum/better-convex-vue', version: '1.0.0-beta.1' }
assert.equal(
  evaluateProvenanceStatement(provenance, provenancePackage, provenanceIntegrity, sourceSha),
  true,
)
assert.throws(
  () =>
    evaluateProvenanceStatement(
      {
        ...provenance,
        predicate: {
          ...provenance.predicate,
          buildDefinition: {
            ...provenance.predicate.buildDefinition,
            externalParameters: {
              workflow: {
                ...provenance.predicate.buildDefinition.externalParameters.workflow,
                path: '.github/workflows/other.yml',
              },
            },
          },
        },
      },
      provenancePackage,
      provenanceIntegrity,
      sourceSha,
    ),
  /wrong bytes, source, or workflow/u,
)

process.stdout.write('Lazy release intent fixtures passed.\n')
