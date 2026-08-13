import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../..')

interface WorkflowStep {
  env?: Record<string, unknown>
  id?: string
  name?: string
  run?: unknown
  uses?: unknown
  with?: Record<string, unknown>
}

interface PreviewWorkflow {
  jobs?: Record<
    string,
    {
      if?: unknown
      permissions?: Record<string, unknown>
      steps?: WorkflowStep[]
    }
  >
  on?: Record<string, unknown>
  permissions?: Record<string, unknown>
}

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8')
}

function normalizedRun(step: WorkflowStep): string | null {
  return typeof step.run === 'string' ? step.run.replace(/\s+/gu, ' ').trim() : null
}

describe('pkg.pr.new package preview workflow', () => {
  const workflow = parse(read('.github/workflows/package-preview.yml')) as PreviewWorkflow
  const preview = workflow.jobs?.preview
  if (!preview) throw new Error('Missing package preview job')
  const steps = preview.steps ?? []
  const runs = steps.map(normalizedRun).filter((run): run is string => run !== null)
  const actions = steps
    .map((step) => step.uses)
    .filter((action): action is string => typeof action === 'string')
  const packageJson = JSON.parse(read('package.json')) as {
    devDependencies?: Record<string, string>
  }
  const lockfile = parse(read('pnpm-lock.yaml')) as {
    importers?: Record<string, { devDependencies?: Record<string, { specifier?: string }> }>
    packages?: Record<string, { resolution?: { integrity?: string } }>
  }

  it('previews same-repository pull-request commits and never executes fork code', () => {
    expect(workflow.on).toEqual({
      pull_request: {
        branches: ['main'],
        types: ['opened', 'synchronize', 'reopened'],
      },
      workflow_dispatch: {},
    })
    expect(preview.if?.toString().replace(/\s+/gu, ' ').trim()).toBe(
      "github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository)",
    )
    const checkout = steps.find((step) => step.uses?.toString().startsWith('actions/checkout@'))
    expect(checkout?.with).toMatchObject({
      'fetch-depth': 0,
      ref: '${{ github.event.pull_request.head.sha || github.sha }}',
    })
  })

  it('has read-only authority and no registry publication credentials', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(preview.permissions).toBeUndefined()
    const structuredWorkflow = JSON.stringify(workflow)
    expect(structuredWorkflow).not.toContain('id-token')
    expect(structuredWorkflow).not.toContain('NODE_AUTH_TOKEN')
    expect(structuredWorkflow).not.toContain('NPM_TOKEN')
    expect(structuredWorkflow).not.toContain('npm publish')
  })

  it('builds only a disposable Vue, Nuxt, and MCP preview set', () => {
    expect(runs).toEqual(
      expect.arrayContaining([
        'pnpm install --frozen-lockfile',
        'node scripts/build-package-preview.mjs',
      ]),
    )
    expect(read('scripts/build-package-preview.mjs')).toContain(
      "const packages = ['vue', 'nuxt', 'mcp'].map",
    )
    expect(runs).not.toContain('pnpm release:prepare')
    expect(runs).not.toContain('pnpm release:artifact:set')
    expect(runs).not.toContain('pnpm release:certify:source core')
    expect(runs.some((run) => /(?:npm|pnpm) pack/u.test(run))).toBe(false)
  })

  it('uses the pinned preview CLI once on the prebuilt tarballs', () => {
    expect(packageJson.devDependencies?.['pkg-pr-new']).toBe('0.0.87')
    expect(lockfile.importers?.['.']?.devDependencies?.['pkg-pr-new']?.specifier).toBe('0.0.87')
    expect(lockfile.packages?.['pkg-pr-new@0.0.87']?.resolution?.integrity).toMatch(/^sha512-/u)

    const publish = runs.filter((run) => run.includes('pnpm exec pkg-pr-new publish '))
    expect(publish).toHaveLength(1)
    expect(publish[0]).toContain('"${TARBALLS[@]}"')
    expect(runs.some((run) => /\b(?:npx|pnpm dlx|yarn dlx|bunx)\b/u.test(run))).toBe(false)
  })

  it('retains all disposable tarballs and verifies the reported SHA-bound install URLs', () => {
    const upload = steps.find((step) =>
      step.uses?.toString().startsWith('actions/upload-artifact@'),
    )
    expect(upload?.with).toMatchObject({
      name: 'package-preview-${{ github.run_id }}',
      path: '${{ steps.artifact.outputs.directory }}/',
    })
    const hostedVerification = steps.find(
      (step) => step.name === 'Verify the hosted preview URLs and bytes',
    )
    expect(hostedVerification?.env).toEqual({
      PREVIEW_SHA: '${{ steps.publish.outputs.sha }}',
      PREVIEW_URLS: '${{ steps.publish.outputs.urls }}',
      SOURCE_COMMIT: '${{ github.event.pull_request.head.sha || github.sha }}',
    })
    const verificationCommand = normalizedRun(hostedVerification ?? {})
    expect(verificationCommand).toBe(
      'node scripts/verify-package-preview.mjs "${{ steps.artifact.outputs.manifest }}"',
    )
  })

  it('pins every third-party action to an exact commit', () => {
    expect(actions.every((action) => /^[^@\s]+@[0-9a-f]{40}$/u.test(action))).toBe(true)
  })
})
