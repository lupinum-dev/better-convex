import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../..')

interface WorkflowStep {
  env?: Record<string, unknown>
  if?: unknown
  name?: string
  run?: unknown
  uses?: unknown
  with?: Record<string, unknown>
}

interface WorkflowJob {
  environment?: unknown
  if?: unknown
  needs?: string | string[]
  permissions?: Record<string, unknown>
  steps?: WorkflowStep[]
}

interface Workflow {
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

function requireJob(workflow: Workflow, jobId: string) {
  const job = workflow.jobs?.[jobId]
  if (!job) throw new Error(`Missing workflow job: ${jobId}`)
  return job
}

function needs(workflow: Workflow, jobId: string) {
  const value = requireJob(workflow, jobId).needs
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function runs(workflow: Workflow, jobId: string) {
  return (requireJob(workflow, jobId).steps ?? [])
    .map(({ run }) => (typeof run === 'string' ? run.replace(/\s+/gu, ' ').trim() : null))
    .filter((run): run is string => run !== null)
}

function uses(workflow: Workflow) {
  return Object.values(workflow.jobs ?? {}).flatMap((job) =>
    (job.steps ?? [])
      .map(({ uses }) => uses)
      .filter((value): value is string => typeof value === 'string'),
  )
}

function checkoutRef(workflow: Workflow, jobId: string) {
  return requireJob(workflow, jobId).steps?.find(({ uses }) =>
    String(uses ?? '').startsWith('actions/checkout@'),
  )?.with?.ref
}

describe('state-aware Better Convex release workflows', () => {
  const ci = parseWorkflow('.github/workflows/ci.yml')
  const publish = parseWorkflow('.github/workflows/publish-prerelease.yml')

  it('keeps release-gate as the final CI aggregator', () => {
    expect(needs(ci, 'release-gate')).toEqual(['source-certification', 'release-candidate'])
    expect(requireJob(ci, 'release-gate').if).toBe('always()')
    const gate = runs(ci, 'release-gate').join('\n')
    expect(gate).toContain('test "$SOURCE_CERTIFICATION" = success')
    expect(gate).toContain('test "$RELEASE_CANDIDATE" = success')
  })

  it('certifies every source lane before building one main-only candidate', () => {
    expect(needs(ci, 'source-certification')).toEqual([
      'classify',
      'secrets',
      'compatibility',
      'dependency-matrix',
      'auth-contracts',
      'auth-real-backend',
      'deployable-app-audits',
      'release-smoke',
    ])
    expect(requireJob(ci, 'release-candidate').if).toContain("github.ref == 'refs/heads/main'")
    expect(needs(ci, 'release-candidate')).toEqual(['source-certification'])

    const candidateRuns = runs(ci, 'release-candidate').join('\n')
    expect(candidateRuns).toContain('node scripts/release-intent.mjs')
    expect(candidateRuns).toContain('pnpm release:artifact:set')
    expect(candidateRuns).toContain('node scripts/release.mjs artifact --package mcp')
    expect(candidateRuns).toContain('node scripts/create-release-candidate.mjs')
    expect(candidateRuns).not.toContain('npm publish')

    const upload = requireJob(ci, 'release-candidate').steps?.find(
      ({ name }) => name === 'Retain the exact release candidate',
    )
    expect(upload?.with).toMatchObject({
      name: 'release-candidate',
      'retention-days': 90,
    })
    const intent = requireJob(ci, 'release-candidate').steps?.find(
      ({ name }) => name === 'Derive the unique incomplete release intent',
    )
    expect(intent?.env).toEqual({ GH_TOKEN: '${{ github.token }}' })
    const mcpBackend = requireJob(ci, 'release-candidate').steps?.find(
      ({ name }) => name === 'Install the reviewed MCP conformance backend',
    )
    expect(mcpBackend).toMatchObject({
      if: "steps.intent.outputs.ready == 'true' && steps.intent.outputs.unit == 'mcp'",
      run: 'pnpm check:auth-backend --install',
    })
    expect(requireJob(ci, 'release-candidate').steps?.indexOf(mcpBackend!)).toBeLessThan(
      requireJob(ci, 'release-candidate').steps?.findIndex(
        ({ name }) => name === 'Verify the MCP unit',
      ) ?? -1,
    )
  })

  it('starts from successful CI or an input-free reconciliation dispatch', () => {
    expect(publish.on).toEqual({
      workflow_run: {
        workflows: ['ci'],
        types: ['completed'],
        branches: ['main'],
      },
      workflow_dispatch: null,
    })
    expect(JSON.stringify(publish.on)).not.toMatch(/version|target|bootstrap_packages/u)
    expect(runs(publish, 'verify').join('\n')).toContain('node scripts/reconcile-release.mjs')
    expect(JSON.stringify(requireJob(publish, 'verify'))).toContain(
      "core.setOutput('active', 'false')",
    )
    expect(JSON.stringify(requireJob(publish, 'verify'))).toContain('for (const unit of units)')
    expect(JSON.stringify(requireJob(publish, 'verify'))).toContain('incompleteUnits.length > 1')
    const verifierRefGuard = requireJob(publish, 'verify').steps?.[0]
    expect(verifierRefGuard).toMatchObject({
      name: 'Require the protected verifier ref',
      env: {
        EVENT_NAME: '${{ github.event_name }}',
        VERIFIER_REF: '${{ github.ref }}',
      },
    })
    expect(verifierRefGuard?.run).toContain('workflow_dispatch')
    expect(verifierRefGuard?.run).toContain('refs/heads/main')
    expect(verifierRefGuard?.run).toContain('exit 1')
    for (const step of requireJob(publish, 'verify').steps?.slice(2) ?? []) {
      expect(step.if).toBe("steps.ci.outputs.active == 'true'")
    }
    expect(requireJob(publish, 'verify').permissions).toEqual({
      actions: 'read',
      contents: 'read',
    })
    expect(checkoutRef(publish, 'verify')).toBe('${{ github.sha }}')
  })

  it('uses one protected OIDC job without privileged source execution', () => {
    const oidcJobs = Object.entries(publish.jobs ?? {}).filter(
      ([, job]) => job.permissions?.['id-token'] === 'write',
    )
    expect(oidcJobs.map(([jobId]) => jobId)).toEqual(['publish-packages'])

    const protectedJob = requireJob(publish, 'publish-packages')
    expect(protectedJob.environment).toBe('npm')
    expect(protectedJob.if).toBe("needs.verify.outputs.action == 'publish'")
    expect(protectedJob.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'id-token': 'write',
    })

    const serializedSteps = JSON.stringify(protectedJob.steps)
    expect(serializedSteps).not.toContain('actions/checkout@')
    expect(serializedSteps).not.toMatch(/pnpm|corepack|npm install|node scripts\//u)
    expect(serializedSteps).toContain("'--provenance'")
    expect(serializedSteps).toContain('record.publishOrder')
    expect(serializedSteps).toContain("evidence.mode === 'absent'")
    expect(serializedSteps).not.toContain('did not expose exact bytes, channel, and provenance')
    expect(serializedSteps).toContain("needs.verify.outputs.first-attempt == 'true'")
    expect(serializedSteps).toContain('git/ref/heads/main')
  })

  it('proves publication and public history without privileged source execution', () => {
    const publication = requireJob(publish, 'verify-publication')
    expect(needs(publish, 'verify-publication')).toEqual(['verify', 'publish-packages'])
    expect(publication.permissions).toEqual({ actions: 'read', contents: 'read' })
    expect(JSON.stringify(publication)).not.toContain('id-token')
    expect(runs(publish, 'verify-publication').join('\n')).toContain('reconcile-release.mjs')
    expect(runs(publish, 'verify-publication').join('\n')).toContain('for delay in 0 5 10 20 40 60')
    expect(runs(publish, 'verify-publication').join('\n')).toContain("pkg.mode === 'oidc'")
    expect(JSON.stringify(publication)).toContain('publication-verified-better-convex-release')
    expect(checkoutRef(publish, 'verify-publication')).toBe('${{ github.sha }}')

    expect(needs(publish, 'github-release')).toEqual(['verify', 'verify-publication'])
    const releaseJob = requireJob(publish, 'github-release')
    expect(releaseJob.permissions).toEqual({
      actions: 'read',
      contents: 'write',
    })
    expect(JSON.stringify(releaseJob)).toContain('publication-verified-better-convex-release')
    const source = runs(publish, 'github-release').join('\n')
    expect(source).toContain('HUMAN-ONLY: GitHub could not create historical tag')
    expect(source).toContain('rerun only this failed Release job')
    expect(source).toContain('git tag $RELEASE_TAG $SOURCE_SHA')
    expect(source).toContain('rm -f .release/registry-verification.json')
    expect(source).toContain('gh release delete-asset')
    expect(source).not.toMatch(/npm publish|pnpm|corepack|npm install|release:artifact/u)

    const completed = requireJob(publish, 'verify-completed-release')
    expect(needs(publish, 'verify-completed-release')).toEqual(['verify', 'github-release'])
    expect(completed.permissions).toEqual({ actions: 'read', contents: 'read' })
    expect(JSON.stringify(completed)).not.toContain('id-token')
    expect(runs(publish, 'verify-completed-release').join('\n')).toContain('reconcile-release.mjs')
    expect(runs(publish, 'verify-completed-release').join('\n')).toContain(
      'test "$ACTION" = complete',
    )
    expect(checkoutRef(publish, 'verify-completed-release')).toBe('${{ github.sha }}')
  })

  it('pins actions and keeps default permissions read-only', () => {
    expect(ci.permissions).toEqual({ contents: 'read' })
    expect(publish.permissions).toEqual({ contents: 'read' })
    expect(uses(ci).every((action) => /^[^@\s]+@[0-9a-f]{40}$/u.test(action))).toBe(true)
    expect(uses(publish).every((action) => /^[^@\s]+@[0-9a-f]{40}$/u.test(action))).toBe(true)

    const source = `${read('.github/workflows/ci.yml')}\n${read(
      '.github/workflows/publish-prerelease.yml',
    )}`
    expect(source).not.toContain('NPM_TOKEN')
    expect(source).not.toContain('NODE_AUTH_TOKEN')
    expect(source).not.toContain('npm dist-tag')
  })
})
