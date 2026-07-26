import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  SECURITY_NOTIFICATION_MAX_AGE_MS,
  validatePrereleaseIdentity,
  validateSecurityGovernance,
} from '../../scripts/check-security-governance.mjs'

const root = resolve(import.meta.dirname, '../..')
const now = new Date('2026-07-17T12:00:00.000Z')

const validInput = {
  deputy: 'BCN Security Deputy',
  notificationTestedAt: '2026-07-17T11:00:00.000Z',
  owner: 'BCN Security Owner',
}

describe('security governance gate', () => {
  it('accepts distinct named roles and current test metadata through the 30-day boundary', () => {
    expect(validateSecurityGovernance(validInput, now)).toEqual([])
    expect(
      validateSecurityGovernance(
        {
          ...validInput,
          notificationTestedAt: new Date(
            now.getTime() - SECURITY_NOTIFICATION_MAX_AGE_MS,
          ).toISOString(),
        },
        now,
      ),
    ).toEqual([])
  })

  it('fails closed for vacant or non-distinct named roles', () => {
    expect(
      validateSecurityGovernance(
        { deputy: ' ', notificationTestedAt: validInput.notificationTestedAt, owner: '' },
        now,
      ),
    ).toEqual([
      'BCN_SECURITY_OWNER must name the current Security Owner',
      'BCN_SECURITY_DEPUTY must name the current Security Owner deputy',
    ])
    expect(
      validateSecurityGovernance(
        { ...validInput, deputy: ' security owner ', owner: 'Security Owner' },
        now,
      ),
    ).toContain('BCN Security Owner and deputy must be distinct people')
  })

  it('rejects absent, invalid, future, and older-than-30-day test timestamps', () => {
    for (const notificationTestedAt of [undefined, '', 'not-a-timestamp']) {
      expect(validateSecurityGovernance({ ...validInput, notificationTestedAt }, now)).toContain(
        'BCN_SECURITY_NOTIFICATION_TESTED_AT must be a valid delivery-test timestamp',
      )
    }

    expect(
      validateSecurityGovernance(
        { ...validInput, notificationTestedAt: '2026-07-17T12:00:00.001Z' },
        now,
      ),
    ).toContain('security notification delivery-test timestamp must not be in the future')
    expect(
      validateSecurityGovernance(
        {
          ...validInput,
          notificationTestedAt: new Date(
            now.getTime() - SECURITY_NOTIFICATION_MAX_AGE_MS - 1,
          ).toISOString(),
        },
        now,
      ),
    ).toContain('security notification delivery-test timestamp must be no older than 30 days')
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
      expect(gate?.env).toMatchObject({
        BCN_SECURITY_DEPUTY: '${{ vars.BCN_SECURITY_DEPUTY }}',
        BCN_SECURITY_NOTIFICATION_TESTED_AT: '${{ vars.BCN_SECURITY_NOTIFICATION_TESTED_AT }}',
        BCN_SECURITY_OWNER: '${{ vars.BCN_SECURITY_OWNER }}',
      })
    }
  })
})
