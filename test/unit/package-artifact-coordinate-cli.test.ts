import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const script = 'scripts/print-package-artifact-coordinates.mjs'

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

describe('package artifact coordinate CLI', () => {
  it('prints only descriptor-derived GitHub output values', () => {
    const result = run(['--package', 'nuxt'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split('\n')).toEqual([
      'artifact_name=release-candidate-nuxt',
      'directory=.release-artifacts/nuxt/0.8.0-beta.26',
      'evidence=.release-artifacts/nuxt/0.8.0-beta.26/artifact.json',
      'package_id=nuxt',
      'package_name=better-convex-nuxt',
      'tarball=.release-artifacts/nuxt/0.8.0-beta.26/better-convex-nuxt-0.8.0-beta.26.tgz',
      'tarball_filename=better-convex-nuxt-0.8.0-beta.26.tgz',
      'version=0.8.0-beta.26',
    ])
  })

  it('prints Vue artifact coordinates from the reviewed nested package', () => {
    const result = run(['--package', 'vue'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim().split('\n')).toEqual([
      'artifact_name=release-candidate-vue',
      'directory=.release-artifacts/vue/0.8.0-beta.26',
      'evidence=.release-artifacts/vue/0.8.0-beta.26/artifact.json',
      'package_id=vue',
      'package_name=better-convex-vue',
      'tarball=.release-artifacts/vue/0.8.0-beta.26/better-convex-vue-0.8.0-beta.26.tgz',
      'tarball_filename=better-convex-vue-0.8.0-beta.26.tgz',
      'version=0.8.0-beta.26',
    ])
  })

  it.each([
    { label: 'missing selector', args: [] },
    { label: 'missing value', args: ['--package'] },
    { label: 'unknown selector', args: ['--package', 'react'] },
    { label: 'path selector', args: ['--package', '../packages/vue'] },
    {
      label: 'duplicate selector',
      args: ['--package', 'nuxt', '--package', 'nuxt'],
    },
    {
      label: 'extra option',
      args: ['--package', 'nuxt', '--directory', '/tmp/output'],
    },
  ])('rejects $label', ({ args }) => {
    const result = run(args)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
  })
})
