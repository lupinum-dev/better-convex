import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  validateReleaseIdentity,
  validateSecurityGovernance,
} from '../../scripts/check-security-governance.mjs'

const root = resolve(import.meta.dirname, '../..')

const validInput = {
  commitAuthor: 'Solo Maintainer <maintainer@example.test>',
  governanceMode: 'solo-maintainer',
  releaseOwner: 'solo-maintainer',
}

describe('security governance gate', () => {
  it('accepts an explicit solo-maintainer prerelease owner and commit author', () => {
    expect(validateSecurityGovernance(validInput)).toEqual([])
  })

  it('fails closed without the exact governance mode or a human release actor', () => {
    expect(
      validateSecurityGovernance({
        ...validInput,
        governanceMode: 'committee',
      }),
    ).toEqual(['BCN_GOVERNANCE_MODE must be solo-maintainer for this release'])
    expect(
      validateSecurityGovernance({
        ...validInput,
        releaseOwner: 'github-actions[bot]',
      }),
    ).toEqual(['RELEASE_OWNER must identify a human release actor'])
    expect(validateSecurityGovernance({ ...validInput, releaseOwner: ' ' })).toEqual([
      'RELEASE_OWNER must identify the release actor',
    ])
    expect(validateSecurityGovernance({ ...validInput, commitAuthor: ' ' })).toEqual([
      'the checked-out release commit must have an author',
    ])
  })

  it('validates stable and prerelease identities for each release target', () => {
    expect(validateReleaseIdentity('v0.7.0-beta.0', '0.7.0-beta.0', 'vue-nuxt')).toEqual([])
    expect(validateReleaseIdentity('v0.7.0', '0.7.0', 'vue-nuxt')).toEqual([])
    expect(validateReleaseIdentity('mcp-v1.0.0', '1.0.0', 'mcp')).toEqual([])
    expect(validateReleaseIdentity('v1.0.0', '1.0.0', 'mcp')).not.toEqual([])
  })

  it('runs before candidate minting with derived GitHub-owned release identity', () => {
    const ci = parse(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')) as {
      jobs?: Record<
        string,
        {
          steps?: Array<{
            env?: Record<string, unknown>
            if?: unknown
            run?: unknown
          }>
        }
      >
    }
    const gate = ci.jobs?.['release-candidate']?.steps?.find(
      (step) => step.run === 'pnpm check:security-governance --release',
    )
    expect(gate?.env).toEqual({
      BCN_GOVERNANCE_MODE: 'solo-maintainer',
      RELEASE_OWNER: '${{ github.actor }}',
      RELEASE_TAG: '${{ steps.intent.outputs.tag }}',
      RELEASE_TARGET: '${{ steps.intent.outputs.unit }}',
    })
    expect(gate?.if).toBe("steps.intent.outputs.ready == 'true'")

    const scheduled = readFileSync(resolve(root, '.github/workflows/security-extended.yml'), 'utf8')
    expect(scheduled).not.toContain('check:security-governance')
    expect(scheduled).not.toContain('BCN_SECURITY_OWNER')
  })

  it('expires the reviewed documentation release-age exceptions', () => {
    const workspace = readFileSync(resolve(root, 'docs/pnpm-workspace.yaml'), 'utf8')
    const reviewedExceptions = [
      '@lupinum/ginko-content@0.4.0-rc.1',
      '@lupinum/ginko-docs@0.3.0-rc.3',
    ]
    const hasReviewedExceptions = reviewedExceptions.some((entry) => workspace.includes(entry))

    if (hasReviewedExceptions) {
      expect(workspace).toContain('Remove after 2026-08-15.')
      expect(Date.now(), 'Remove the expired documentation release-age exceptions.').toBeLessThan(
        Date.parse('2026-08-16T00:00:00Z'),
      )
    }
  })
})
