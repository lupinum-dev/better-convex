import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  validatePrereleaseIdentity,
  validateSecurityGovernance,
} from '../../scripts/check-security-governance.mjs'

const root = resolve(import.meta.dirname, '../..')

const validInput = {
  licensingReviewer: 'BCN Licensing Reviewer',
  owner: 'BCN Security Owner',
}

describe('security governance gate', () => {
  it('accepts one named security owner for ongoing maintenance', () => {
    expect(validateSecurityGovernance(validInput)).toEqual([])
    expect(validateSecurityGovernance({ ...validInput, licensingReviewer: '' })).toEqual([])
  })

  it('fails closed without a named owner', () => {
    expect(validateSecurityGovernance({ ...validInput, owner: ' ' })).toEqual([
      'BCN_SECURITY_OWNER must name the current Security Owner',
    ])
  })

  it('requires a human licensing reviewer for a prerelease and permits self-review', () => {
    expect(validateSecurityGovernance(validInput, { requireLicensingReviewer: true })).toEqual([])
    expect(
      validateSecurityGovernance(
        { licensingReviewer: 'Solo Maintainer', owner: 'Solo Maintainer' },
        { requireLicensingReviewer: true },
      ),
    ).toEqual([])
    expect(
      validateSecurityGovernance(
        { ...validInput, licensingReviewer: ' ' },
        { requireLicensingReviewer: true },
      ),
    ).toEqual(['BCN_LICENSE_REVIEWER must name the human who reviewed package licensing'])
  })

  it('keeps prerelease tag validation in the direct workflow script', () => {
    expect(validatePrereleaseIdentity('v0.7.0-beta.0', '0.7.0-beta.0')).toEqual([])
    expect(validatePrereleaseIdentity('v0.7.0', '0.7.0')).not.toEqual([])
    expect(validatePrereleaseIdentity('v0.7.0-beta.1', '0.7.0-beta.0')).not.toEqual([])
  })

  it('runs the one gate in prerelease and scheduled security workflows', () => {
    for (const [path, command] of [
      ['.github/workflows/publish-prerelease.yml', 'pnpm check:security-governance --prerelease'],
      ['.github/workflows/security-extended.yml', 'pnpm check:security-governance'],
    ] as const) {
      const workflow = parse(readFileSync(resolve(root, path), 'utf8')) as {
        jobs?: Record<string, { steps?: Array<{ env?: Record<string, unknown>; run?: unknown }> }>
      }
      const gate = Object.values(workflow.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .find((step) => step.run === command)
      expect(gate?.env).toEqual(
        path.includes('publish-prerelease')
          ? {
              BCN_LICENSE_REVIEWER: '${{ vars.BCN_LICENSE_REVIEWER }}',
              BCN_SECURITY_OWNER: '${{ vars.BCN_SECURITY_OWNER }}',
              RELEASE_TAG: '${{ github.ref_name }}',
            }
          : {
              BCN_SECURITY_OWNER: '${{ vars.BCN_SECURITY_OWNER }}',
            },
      )
    }
  })
})
