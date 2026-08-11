import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const checker = 'scripts/check-package-exports.mjs'

function runChecker(args: string[]) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

function combinedOutput(result: ReturnType<typeof runChecker>): string {
  return `${result.stdout}\n${result.stderr}`
}

function expectPreflightFailure(args: string[], expectedMessage: string | RegExp): void {
  const result = runChecker(args)
  const output = combinedOutput(result)

  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(1)
  expect(output).toMatch(expectedMessage)
  expect(output).not.toContain('Packing and extracting')
  expect(output).not.toContain('requires a built dist/')
  expect(output).not.toContain('Package export validation failed')
}

describe('package export checker CLI authority', () => {
  it.each([
    {
      label: 'missing package owner',
      args: [],
      expected: '--package requires a reviewed package identifier.',
    },
    {
      label: 'unknown package owner',
      args: ['--package', 'react', '--dist-only'],
      expected: 'Unknown package certification descriptor: react',
    },
    {
      label: 'duplicate package owner',
      args: ['--package', 'nuxt', '--package=nuxt', '--dist-only'],
      expected: '--package may be supplied only once.',
    },
    {
      label: 'path-like package owner',
      args: ['--package', '../packages/vue', '--dist-only'],
      expected: 'Unknown package certification descriptor: ../packages/vue',
    },
    {
      label: 'unknown option',
      args: ['--package', 'nuxt', '--not-reviewed'],
      expected: 'Unknown package-check option: --not-reviewed',
    },
    {
      label: 'tarball conflict',
      args: ['--package', 'nuxt', '--dist-only', '--tarball', 'unreviewed.tgz'],
      expected: '--dist-only cannot be combined with --tarball, --manifest, or --vue-tarball.',
    },
    {
      label: 'manifest conflict',
      args: ['--package', 'nuxt', '--manifest', 'unreviewed.json', '--dist-only'],
      expected: '--dist-only cannot be combined with --tarball, --manifest, or --vue-tarball.',
    },
    {
      label: 'Vue companion dist conflict',
      args: ['--package', 'nuxt', '--vue-tarball', 'unreviewed.tgz', '--dist-only'],
      expected: '--dist-only cannot be combined with --tarball, --manifest, or --vue-tarball.',
    },
    {
      label: 'Vue package companion',
      args: ['--package', 'vue', '--vue-tarball', 'unreviewed.tgz'],
      expected: '--vue-tarball is valid only for the reviewed Nuxt package.',
    },
    {
      label: 'duplicate Vue companion',
      args: ['--package', 'nuxt', '--vue-tarball', 'first.tgz', '--vue-tarball=second.tgz'],
      expected: '--vue-tarball may be supplied only once.',
    },
    {
      label: 'supplied Nuxt candidate without its reviewed Vue companion',
      args: ['--package', 'nuxt', '--tarball', 'unreviewed.tgz'],
      expected: '--vue-tarball is required when verifying a supplied Nuxt tarball.',
    },
  ])('rejects $label before artifact work', ({ args, expected }) => {
    expectPreflightFailure(args, expected)
  })

  it('allows the reviewed Nuxt package to reach the normal dist checker', () => {
    const result = runChecker(['--package', 'nuxt', '--dist-only'])
    const output = combinedOutput(result)

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(output).not.toContain('Unknown package-check option')
    expect(output).not.toContain('--package requires')
    expect(output).not.toContain('Unknown package certification descriptor')

    if (result.status === 0) {
      expect(output).toMatch(/nuxt dist-entry gate passed/u)
    } else {
      expect(result.status).toBe(1)
      expect(output).toMatch(
        /(?:check:package-exports requires a built dist\/|Package export validation failed)/u,
      )
    }
  }, 45_000)

  it('allows the reviewed Vue package to reach its strict dist checker', () => {
    const result = runChecker(['--package', 'vue', '--dist-only'])
    const output = combinedOutput(result)

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, output).toBe(0)
    expect(output).toMatch(/vue dist-entry gate passed/u)
  }, 45_000)
})
