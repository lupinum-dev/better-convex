import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  compareMonitoringSnapshot,
  matchesAuthorizedSeam,
  normalizeSourceSeamChanges,
  validateMonitoringLedger,
} from '../../scripts/check-auth-upstream.mjs'

const root = resolve(import.meta.dirname, '../..')
const ledger = JSON.parse(
  readFileSync(resolve(root, 'security/upstream-convex-better-auth.json'), 'utf8'),
)

function recordedObservation() {
  const monitoring = ledger.monitoring
  return {
    defaultBranch: {
      name: monitoring.defaultBranch.name,
      head: monitoring.defaultBranch.head,
      compareStatus: monitoring.defaultBranch.compareStatus,
      sourceSeamChanges: structuredClone(monitoring.defaultBranch.sourceSeamChanges),
    },
    releases: structuredClone(monitoring.releases.items),
    securityAdvisories: structuredClone(monitoring.securityAdvisories.items),
    issue395: {
      number: monitoring.issue395.number,
      state: monitoring.issue395.state,
      title: monitoring.issue395.title,
      updatedAt: monitoring.issue395.updatedAt,
      url: monitoring.issue395.url,
    },
    pull380: {
      number: monitoring.pull380.number,
      state: monitoring.pull380.state,
      merged: monitoring.pull380.merged,
      title: monitoring.pull380.title,
      updatedAt: monitoring.pull380.updatedAt,
      url: monitoring.pull380.url,
      headSha: monitoring.pull380.headSha,
      baseSha: monitoring.pull380.baseSha,
    },
  }
}

describe('auth upstream monitoring', () => {
  it('accepts the current reviewed canonical ledger within its monthly window', () => {
    expect(validateMonitoringLedger(ledger, new Date('2026-07-16T12:00:00Z'))).toEqual([])
  })

  it('fails closed when the monthly review expires or a patch remains required', () => {
    expect(validateMonitoringLedger(ledger, new Date('2026-08-17T00:00:01Z'))).toContain(
      'upstream monitoring review expired on 2026-07-16; complete the monthly review',
    )

    const patchRequired = structuredClone(ledger)
    patchRequired.monitoring.issue395.disposition = 'patch required'
    expect(validateMonitoringLedger(patchRequired, new Date('2026-07-16T12:00:00Z'))).toContain(
      'issue #395 still requires an imported security patch',
    )
  })

  it('detects remote issue, PR, release, advisory, branch, and seam drift', () => {
    const current = recordedObservation()
    expect(compareMonitoringSnapshot(ledger.monitoring, current)).toEqual([])

    current.issue395.updatedAt = '2026-07-17T00:00:00Z'
    current.pull380.headSha = 'f'.repeat(40)
    current.releases.push({
      tagName: 'v0.12.6',
      publishedAt: '2026-07-17T00:00:00Z',
      url: 'https://github.com/get-convex/better-auth/releases/tag/v0.12.6',
      draft: false,
      prerelease: false,
    })
    current.securityAdvisories.push({
      ghsaId: 'GHSA-xxxx-yyyy-zzzz',
      cveId: null,
      severity: 'high',
      publishedAt: '2026-07-17T00:00:00Z',
      updatedAt: '2026-07-17T00:00:00Z',
      withdrawnAt: null,
      url: 'https://github.com/get-convex/better-auth/security/advisories/GHSA-xxxx-yyyy-zzzz',
    })
    current.defaultBranch.head = 'e'.repeat(40)
    current.defaultBranch.compareStatus = 'ahead'
    current.defaultBranch.sourceSeamChanges.push({
      filename: 'src/client/adapter.ts',
      status: 'modified',
      sha: 'd'.repeat(40),
    })

    expect(compareMonitoringSnapshot(ledger.monitoring, current)).toEqual(
      expect.arrayContaining([
        'default-branch head changed upstream and needs a reviewed disposition',
        'baseline comparison status changed upstream and needs a reviewed disposition',
        'enumerated source-seam diff changed upstream and needs a reviewed disposition',
        'GitHub releases changed upstream and needs a reviewed disposition',
        'repository security advisories changed upstream and needs a reviewed disposition',
        'issue #395 changed upstream and needs a reviewed disposition',
        'PR #380 changed upstream and needs a reviewed disposition',
      ]),
    )
  })

  it('diffs only the provenance ledger source seams', () => {
    expect(matchesAuthorizedSeam('src/client/adapter.ts', 'src/client/adapter.ts')).toBe(true)
    expect(matchesAuthorizedSeam('src/nextjs/index.ts', 'src/client/adapter.ts')).toBe(false)
    expect(
      normalizeSourceSeamChanges(
        [
          { filename: 'src/client/adapter.ts', status: 'modified', sha: 'a'.repeat(40) },
          { filename: 'docs/index.md', status: 'modified', sha: 'b'.repeat(40) },
          {
            filename: 'src/component/_generated/api.ts',
            status: 'renamed',
            sha: 'c'.repeat(40),
            previous_filename: 'src/component/_generated/old-api.ts',
          },
          {
            filename: 'attic/adapter.ts',
            status: 'renamed',
            sha: 'd'.repeat(40),
            previous_filename: 'src/client/adapter.ts',
          },
        ],
        ledger.authorizedSourceSeams,
      ),
    ).toEqual([
      {
        filename: 'attic/adapter.ts',
        status: 'renamed',
        sha: 'd'.repeat(40),
        previousFilename: 'src/client/adapter.ts',
      },
      { filename: 'src/client/adapter.ts', status: 'modified', sha: 'a'.repeat(40) },
      {
        filename: 'src/component/_generated/api.ts',
        status: 'renamed',
        sha: 'c'.repeat(40),
        previousFilename: 'src/component/_generated/old-api.ts',
      },
    ])
  })

  it('is wired into nightly, monthly-review, and immutable prerelease gates', () => {
    const securityWorkflow = parse(
      readFileSync(resolve(root, '.github/workflows/security-extended.yml'), 'utf8'),
    ) as {
      on?: { schedule?: Array<{ cron?: string }> }
      jobs?: Record<string, { steps?: Array<{ run?: string }> }>
    }
    const publishWorkflow = parse(
      readFileSync(resolve(root, '.github/workflows/publish-prerelease.yml'), 'utf8'),
    ) as { jobs?: Record<string, { steps?: Array<{ run?: string }> }> }
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

    expect(securityWorkflow.on?.schedule?.map(({ cron }) => cron)).toEqual(
      expect.arrayContaining(['41 2 * * *', '23 3 1 * *']),
    )
    expect(
      Object.values(securityWorkflow.jobs ?? {}).some((job) =>
        job.steps?.some(({ run }) => run === 'pnpm check:auth-upstream'),
      ),
    ).toBe(true)
    expect(packageJson.scripts['verify:auth']).toContain('pnpm check:auth-upstream')
    const verifyRuns = publishWorkflow.jobs?.['verify-candidates']?.steps
      ?.map(({ run }) => run?.replace(/\s+/gu, ' ').trim())
      .filter((run): run is string => run !== undefined)
    expect(verifyRuns).toEqual(
      expect.arrayContaining([
        'pnpm release:verify:set "${{ steps.candidate_set.outputs.evidence }}"',
        'pnpm release:verify --package mcp --artifact-manifest "${{ steps.mcp.outputs.evidence }}"',
      ]),
    )
  })
})
