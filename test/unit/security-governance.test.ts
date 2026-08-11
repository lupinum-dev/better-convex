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
  commitAuthor: 'Solo Maintainer <maintainer@example.test>',
  governanceMode: 'solo-maintainer',
  releaseOwner: 'solo-maintainer',
}

describe('security governance gate', () => {
  it('accepts an explicit solo-maintainer prerelease owner and commit author', () => {
    expect(validateSecurityGovernance(validInput)).toEqual([])
  })

  it('fails closed without the exact governance mode or a human tag actor', () => {
    expect(
      validateSecurityGovernance({
        ...validInput,
        governanceMode: 'committee',
      }),
    ).toEqual(['BCN_GOVERNANCE_MODE must be solo-maintainer for this prerelease'])
    expect(
      validateSecurityGovernance({
        ...validInput,
        releaseOwner: 'github-actions[bot]',
      }),
    ).toEqual(['RELEASE_OWNER must identify a human tag actor'])
    expect(validateSecurityGovernance({ ...validInput, releaseOwner: ' ' })).toEqual([
      'RELEASE_OWNER must identify the tag actor',
    ])
    expect(validateSecurityGovernance({ ...validInput, commitAuthor: ' ' })).toEqual([
      'the checked-out release commit must have an author',
    ])
  })

  it('keeps prerelease tag validation in the direct workflow script', () => {
    expect(validatePrereleaseIdentity('v0.7.0-beta.0', '0.7.0-beta.0')).toEqual([])
    expect(validatePrereleaseIdentity('v0.7.0', '0.7.0')).not.toEqual([])
    expect(validatePrereleaseIdentity('v0.7.0-beta.1', '0.7.0-beta.0')).not.toEqual([])
  })

  it('runs only in the prerelease workflow with GitHub-owned release identity', () => {
    const prerelease = parse(
      readFileSync(resolve(root, '.github/workflows/publish-prerelease.yml'), 'utf8'),
    ) as {
      jobs?: Record<string, { steps?: Array<{ env?: Record<string, unknown>; run?: unknown }> }>
    }
    const gate = Object.values(prerelease.jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .find((step) => step.run === 'pnpm check:security-governance --prerelease')
    expect(gate?.env).toEqual({
      BCN_GOVERNANCE_MODE: 'solo-maintainer',
      RELEASE_OWNER: '${{ github.actor }}',
      RELEASE_TAG: '${{ github.ref_name }}',
    })

    const scheduled = readFileSync(resolve(root, '.github/workflows/security-extended.yml'), 'utf8')
    expect(scheduled).not.toContain('check:security-governance')
    expect(scheduled).not.toContain('BCN_SECURITY_OWNER')
  })
})
