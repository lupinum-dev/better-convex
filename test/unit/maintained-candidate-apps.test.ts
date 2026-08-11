import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getMaintainedCandidateProfile,
  validateCandidateTestProfiles,
} from '../../scripts/maintained-candidate-apps.mjs'
import { packageCertificationDescriptors } from '../../scripts/package-certification-manifest.mjs'

function currentProfiles() {
  return Object.fromEntries(
    packageCertificationDescriptors.map(
      (descriptor: { id: string; profiles: { candidateTests: string } }) => [
        descriptor.profiles.candidateTests,
        getMaintainedCandidateProfile(descriptor.id).profile,
      ],
    ),
  )
}

function allRunners() {
  return Object.values(currentProfiles()).flatMap((profile) =>
    profile.kind === 'runners' ? profile.runners : profile.browserRunners,
  )
}

function runCandidateRunner(runner: string, arguments_: string[]) {
  return new Promise<{ runner: string; status: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [runner, ...arguments_], {
        cwd: join(import.meta.dirname, '../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (status) => resolve({ runner, status, stderr, stdout }))
    },
  )
}

describe('maintained candidate-test profiles', () => {
  it('selects every closed package descriptor without restating its candidate matrix', () => {
    for (const descriptor of packageCertificationDescriptors as Array<{
      id: string
      profiles: { candidateTests: string }
    }>) {
      const selected = getMaintainedCandidateProfile(descriptor.id)
      expect(selected.descriptor).toBe(descriptor)
      expect(selected.profile.kind).toMatch(/^(?:apps|runners)$/u)
      expect(Object.isFrozen(selected)).toBe(true)
      expect(Object.isFrozen(selected.profile)).toBe(true)
    }
  })

  it('keeps all nested profile data immutable', () => {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      expect(Object.isFrozen(value)).toBe(true)
      for (const nested of Object.values(value)) visit(nested)
    }
    for (const profile of Object.values(currentProfiles())) visit(profile)
  })

  it('keeps non-starter demo applications outside the maintained starter surface', () => {
    const selected = getMaintainedCandidateProfile('nuxt')
    const names = selected.profile.pnpmApps.map((entry: { name: string }) => entry.name)
    expect(names).not.toContain('agentic-saas')
    expect(names).not.toContain('demo')
  })

  it('rejects a runner that is not a real repository-owned consumer', () => {
    const profiles = structuredClone(currentProfiles())
    profiles['vue-maintained-consumers'].runners[0] = 'scripts/check-vue-missing-consumer.mjs'
    expect(() => validateCandidateTestProfiles(profiles)).toThrow(
      'Candidate runner scripts/check-vue-missing-consumer.mjs is missing',
    )
  })

  it('rejects unsafe fixtures, duplicate runners, unknown companions, and an open profile map', () => {
    const unsafeFixtureProfiles = structuredClone(currentProfiles())
    unsafeFixtureProfiles['nuxt-maintained-consumers'].pnpmApps[0].path = '../demo'
    expect(() => validateCandidateTestProfiles(unsafeFixtureProfiles)).toThrow(
      'has an invalid name or path',
    )

    const duplicateRunnerProfiles = structuredClone(currentProfiles())
    duplicateRunnerProfiles['mcp-maintained-consumers'].runners[1] =
      duplicateRunnerProfiles['mcp-maintained-consumers'].runners[0]
    expect(() => validateCandidateTestProfiles(duplicateRunnerProfiles)).toThrow(
      'non-empty list of unique strings',
    )

    const unknownCompanionProfiles = structuredClone(currentProfiles())
    unknownCompanionProfiles['nuxt-maintained-consumers'].companionPackages = ['react']
    expect(() => validateCandidateTestProfiles(unknownCompanionProfiles)).toThrow(
      'Unknown package certification descriptor: react',
    )

    const openProfiles = { ...structuredClone(currentProfiles()), extra: {} }
    expect(() => validateCandidateTestProfiles(openProfiles)).toThrow(
      'does not match the package certification manifest',
    )
  })

  it('executes every configured runner and proves it consumes the supplied artifact path', async () => {
    const missingTarball = join(import.meta.dirname, 'missing-candidate-artifact.tgz')
    const results = await Promise.all(
      allRunners().map((runner) =>
        runCandidateRunner(
          runner,
          runner.includes('check-nuxt-')
            ? ['--nuxt-tarball', missingTarball, '--vue-tarball', missingTarball]
            : ['--tarball', missingTarball],
        ),
      ),
    )
    for (const result of results) {
      const { runner } = result
      expect(result.status, runner).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`, runner).toContain(missingTarball)
    }
  })

  it('rejects package IDs outside the certification manifest', () => {
    expect(() => getMaintainedCandidateProfile('react')).toThrow(
      'Unknown package certification descriptor: react',
    )
  })
})
