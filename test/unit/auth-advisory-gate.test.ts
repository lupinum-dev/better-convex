import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  evaluateFindings,
  parseGitHubAdvisories,
  parsePnpmAudit,
  validateExceptionPolicy,
} from '../../scripts/check-auth-advisories.mjs'
import { reviewedAdvisoryTuple } from '../../scripts/reviewed-runtime-versions.mjs'
import { supportedDependencyTuple } from '../../scripts/supported-dependency-tuple.mjs'

const NOW = Date.parse('2026-07-16T00:00:00.000Z')
const CONVEX_VERSION = supportedDependencyTuple.convex
const mcpManifest = JSON.parse(
  readFileSync(new URL('../../packages/mcp/package.json', import.meta.url), 'utf8'),
)

function exception(overrides: Record<string, string> = {}) {
  return {
    id: 'GHSA-test-test-test',
    source: 'npm',
    auditScope: 'repository',
    package: 'convex',
    version: CONVEX_VERSION,
    owner: 'Ada Security',
    mitigation: 'The affected parser is disabled at the only call site.',
    reason: 'A patched upstream release is not yet available.',
    sourceUrl: 'https://github.com/advisories/GHSA-test-test-test',
    createdAt: '2026-07-15T00:00:00.000Z',
    expiresAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  }
}

function syntheticFinding() {
  return {
    source: 'npm',
    id: 'GHSA-test-test-test',
    package: 'convex',
    version: CONVEX_VERSION,
    severity: 'high',
    sourceUrl: 'https://github.com/advisories/GHSA-test-test-test',
    paths: ['.>convex'],
    scope: 'complete',
  }
}

describe('auth advisory gate', () => {
  it('derives exact sibling-package runtime queries from reviewed manifests', () => {
    expect(reviewedAdvisoryTuple).toMatchObject({
      '@modelcontextprotocol/ext-apps':
        mcpManifest.devDependencies['@modelcontextprotocol/ext-apps'],
      '@modelcontextprotocol/server': mcpManifest.dependencies['@modelcontextprotocol/server'],
      convex: supportedDependencyTuple.convex,
      vue: mcpManifest.devDependencies.vue,
    })
  })

  it('fails a synthetic high-severity advisory against the exact supported tuple', () => {
    const result = evaluateFindings([syntheticFinding()], [])
    expect(result.applicable).toEqual([syntheticFinding()])
    expect(result.excepted).toEqual([])
  })

  it('accepts an exact owned exception for no more than 30 days', () => {
    const exceptions = validateExceptionPolicy({ schemaVersion: 2, exceptions: [exception()] }, NOW)
    const result = evaluateFindings([syntheticFinding()], exceptions)
    expect(result.applicable).toEqual([])
    expect(result.excepted).toHaveLength(1)
  })

  it('does not let one advisory exception cover another affected version', () => {
    const exceptions = validateExceptionPolicy(
      {
        schemaVersion: 2,
        exceptions: [exception({ package: 'brace-expansion', version: '2.1.2' })],
      },
      NOW,
    )
    const finding = {
      ...syntheticFinding(),
      package: 'brace-expansion',
      version: '2.1.3',
    }
    expect(() => evaluateFindings([finding], exceptions)).toThrow('Stale exceptions')
  })

  it('rejects expired, overlong, anonymous, and stale exceptions', () => {
    expect(() =>
      validateExceptionPolicy(
        {
          schemaVersion: 2,
          exceptions: [exception({ expiresAt: '2026-07-16T00:00:00.000Z' })],
        },
        NOW,
      ),
    ).toThrow('expired')
    expect(() =>
      validateExceptionPolicy(
        {
          schemaVersion: 2,
          exceptions: [exception({ expiresAt: '2026-08-20T00:00:00.000Z' })],
        },
        NOW,
      ),
    ).toThrow('30-day')
    expect(() =>
      validateExceptionPolicy({ schemaVersion: 2, exceptions: [exception({ owner: '' })] }, NOW),
    ).toThrow('owner')
    expect(() =>
      validateExceptionPolicy(
        { schemaVersion: 2, exceptions: [exception({ auditScope: 'all' })] },
        NOW,
      ),
    ).toThrow('auditScope')
    const exceptions = validateExceptionPolicy({ schemaVersion: 2, exceptions: [exception()] }, NOW)
    expect(() => evaluateFindings([], exceptions)).toThrow('Stale exceptions')
  })

  it('parses exact npm audit findings and fails closed on registry errors', () => {
    expect(
      parsePnpmAudit(
        {
          advisories: {
            1: {
              github_advisory_id: 'GHSA-test-test-test',
              module_name: 'convex',
              severity: 'high',
              url: 'https://github.com/advisories/GHSA-test-test-test',
              findings: [{ version: CONVEX_VERSION, paths: ['.>convex'] }],
            },
          },
        },
        'synthetic',
      ),
    ).toEqual([{ ...syntheticFinding(), scope: 'synthetic' }])
    expect(() =>
      parsePnpmAudit({ error: { code: 'ENOTFOUND', message: 'registry unavailable' } }, 'test'),
    ).toThrow('registry unavailable')
  })

  it('binds GitHub tuple advisories to the exact supported version', () => {
    const findings = parseGitHubAdvisories(
      [
        {
          ghsa_id: 'GHSA-test-test-test',
          html_url: 'https://github.com/advisories/GHSA-test-test-test',
          severity: 'critical',
          vulnerabilities: [{ package: { name: 'convex' } }],
        },
      ],
      'github',
      'unused',
      'convex',
    )
    expect(findings[0]).toMatchObject({
      package: 'convex',
      version: CONVEX_VERSION,
      severity: 'critical',
    })
  })

  it('treats every published imported-source advisory as requiring a decision', () => {
    const findings = parseGitHubAdvisories(
      [
        {
          ghsa_id: 'GHSA-upstream-test-test',
          html_url:
            'https://github.com/get-convex/better-auth/security/advisories/GHSA-upstream-test-test',
          severity: 'high',
        },
      ],
      'upstream',
      'c628916b451a6b4cff0f5464f134475464b1a6da',
    )
    expect(findings[0]).toMatchObject({
      source: 'upstream',
      package: 'get-convex/better-auth',
      version: 'c628916b451a6b4cff0f5464f134475464b1a6da',
    })
  })
})
