import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parse } from 'yaml'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const publishSource = read('.github/workflows/publish-prerelease.yml')
const ciSource = read('.github/workflows/ci.yml')
const publish = parse(publishSource)
const ci = parse(ciSource)

assert.equal(
  publish.name,
  'publish-prerelease',
  'The npm trusted-publisher workflow identity must not change.',
)
assert.deepEqual(publish.on.workflow_dispatch, null, 'Manual reconciliation must be input-free.')
assert.deepEqual(publish.on.workflow_run.workflows, ['ci'])
assert.deepEqual(publish.on.workflow_run.types, ['completed'])
assert.deepEqual(publish.on.workflow_run.branches, ['main'])
assert.equal(publish.concurrency['cancel-in-progress'], false)
assert.equal(publish.permissions.contents, 'read')
assert(
  !/NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_TOKEN/u.test(`${publishSource}\n${ciSource}`),
  'Release workflows must not use npm tokens.',
)

const npmJobs = Object.entries(publish.jobs).filter(
  ([, job]) =>
    (typeof job.environment === 'string' ? job.environment : job.environment?.name) === 'npm',
)
assert.equal(npmJobs.length, 1, 'Exactly one protected npm job is allowed.')
const [publishName, protectedJob] = npmJobs[0]
assert.equal(publishName, 'publish-packages')
assert.deepEqual(protectedJob.permissions, {
  actions: 'read',
  contents: 'read',
  'id-token': 'write',
})
const protectedSource = JSON.stringify(protectedJob)
assert(
  !protectedSource.includes('actions/checkout@'),
  'The protected job must not checkout repository code.',
)
assert(
  !/(?:pnpm|npm|yarn) (?:install|ci|run)|node scripts\//u.test(protectedSource),
  'The protected job must not install dependencies or run repository scripts.',
)
assert(protectedSource.includes('--provenance') && protectedSource.includes('--ignore-scripts'))
assert(
  protectedSource.includes('record.publishOrder'),
  'The protected job must obey the certified publish order.',
)

const verify = publish.jobs.verify
assert(verify.permissions.actions === 'read' && verify.permissions.contents === 'read')
assert(
  String(verify.if).includes("workflow_run.conclusion == 'success'") &&
    String(verify.if).includes("workflow_run.event == 'push'") &&
    String(verify.if).includes("workflow_run.head_branch == 'main'"),
)
const verifySource = JSON.stringify(verify)
for (const required of [
  "workflow_id: 'ci.yml'",
  "status: 'success'",
  "event: 'push'",
  "branch: 'main'",
  'listWorkflowRunArtifacts',
  'artifact.expired === false',
  "core.setOutput('active', 'false')",
  "core.setOutput('active', 'true')",
  'incomplete.length > 1',
  'const selected = incomplete[0] ?? retained[0]',
  "core.setOutput('run-id', String(selected.id))",
  "core.setOutput('sha', selected.head_sha)",
  'github.run_attempt == 1',
])
  assert(verifySource.includes(required), `Candidate verification is missing ${required}.`)
for (const step of verify.steps.slice(1)) {
  assert.equal(
    step.if,
    "steps.ci.outputs.active == 'true'",
    `${step.name ?? step.uses} must skip on a clean no-op.`,
  )
}
assert(
  verifySource.includes('reconcile-release.mjs') &&
    verifySource.includes('registry-verification.json') === false,
  'The unprivileged verifier must derive registry evidence before approval.',
)

const release = publish.jobs['github-release']
assert.equal(release.permissions.contents, 'write')
assert(!JSON.stringify(release).includes('id-token'))
for (const required of [
  'HUMAN-ONLY',
  'HTTP 403',
  'Resource not accessible by integration',
  'git/ref/tags/$RELEASE_TAG',
  'sha="$SOURCE_SHA"',
  'gh release create',
  'gh release view',
  'gh release edit',
]) {
  assert(publishSource.includes(required), `GitHub Release repair is missing ${required}.`)
}

const candidate = ci.jobs['release-candidate']
assert(candidate, 'CI must own candidate creation.')
assert.equal(candidate.needs, 'source-certification')
assert(
  String(candidate.if).includes("github.event_name == 'push'") &&
    String(candidate.if).includes("github.ref == 'refs/heads/main'"),
)
const upload = candidate.steps.find((step) =>
  String(step.uses ?? '').startsWith('actions/upload-artifact@'),
)
assert.equal(upload.with.name, 'release-candidate')
assert.equal(upload.with['retention-days'], 90)
assert(
  ci.jobs['release-gate'].needs.includes('release-candidate'),
  'The required release-gate must aggregate candidate success.',
)

for (const [path, source] of [
  ['ci.yml', ciSource],
  ['publish-prerelease.yml', publishSource],
]) {
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const reference = match[1].split('@')[1]
    assert(/^[0-9a-f]{40}$/u.test(reference ?? ''), `${path} has an unpinned Action: ${match[1]}`)
  }
}

process.stdout.write('Lazy release workflow policy passed.\n')
