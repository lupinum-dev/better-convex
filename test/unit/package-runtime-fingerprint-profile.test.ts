import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as tar from 'tar'
import { describe, expect, it } from 'vitest'

import {
  assertPackedRuntimeFingerprintBinding,
  assertRuntimeFingerprintEvidence,
  assertRuntimeFingerprintProfile,
  bindPackageRuntimeFingerprintBuild,
  derivePackageRuntimeFingerprint,
  getPackageRuntimeFingerprintProfile,
} from '../../scripts/package-runtime-fingerprint-profile.mjs'

function writePackedFixture(directory: string, moduleSuffix = '') {
  const packageRoot = join(directory, 'package')
  mkdirSync(join(packageRoot, 'dist/runtime/shared'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"better-convex-nuxt"}\n')
  writeFileSync(
    join(packageRoot, 'dist/module.mjs'),
    `import { getPackedRuntimeFingerprint } from '../dist/runtime/shared/release-fingerprint.js'\n${moduleSuffix}`,
  )
  writeFileSync(
    join(packageRoot, 'dist/runtime/shared/release-fingerprint.js'),
    "const value = '__BCN_RELEASE_RUNTIME_FINGERPRINT__'\n",
  )
  const tarball = join(directory, 'candidate.tgz')
  tar.c(
    {
      cwd: directory,
      file: tarball,
      gzip: true,
      noDirRecurse: true,
      portable: true,
      strict: true,
      sync: true,
    },
    [
      'package/dist/module.mjs',
      'package/dist/runtime/shared/release-fingerprint.js',
      'package/package.json',
    ],
  )
  return { packageRoot, tarball }
}

describe('package runtime-fingerprint profiles', () => {
  it('selects the exact required Nuxt runtime binding', () => {
    const selected = getPackageRuntimeFingerprintProfile('nuxt')
    expect(selected.descriptor.profiles.runtimeFingerprint).toBe('nuxt-runtime-binding')
    expect(selected.profile).toEqual({
      buildFiles: ['dist/runtime/shared/release-fingerprint.js'],
      mode: 'required',
      moduleBindings: [
        {
          helperImport: '../dist/runtime/shared/release-fingerprint.js',
          packedFile: 'dist/module.mjs',
        },
      ],
      packedFiles: ['dist/runtime/shared/release-fingerprint.js'],
      token: '__BCN_RELEASE_RUNTIME_FINGERPRINT__',
    })
    expect(Object.isFrozen(selected.profile)).toBe(true)
    expect(Object.isFrozen(selected.profile.buildFiles)).toBe(true)
    expect(Object.isFrozen(selected.profile.moduleBindings[0])).toBe(true)
  })

  it('requires a generated fingerprint and rejects placeholders or malformed values', () => {
    const { profile } = getPackageRuntimeFingerprintProfile('nuxt')
    expect(() =>
      assertRuntimeFingerprintEvidence(profile, `bcn-release-v1-${'a'.repeat(64)}`),
    ).not.toThrow()
    for (const value of [
      undefined,
      null,
      '',
      '__BCN_RELEASE_RUNTIME_FINGERPRINT__',
      `bcn-release-v1-${'g'.repeat(64)}`,
    ]) {
      expect(() => assertRuntimeFingerprintEvidence(profile, value), String(value)).toThrow(
        'Runtime fingerprint is required',
      )
    }
  })

  it('derives and independently binds one reproducible packed-payload coordinate', () => {
    const version = '0.8.0-beta.33'
    const firstDirectory = mkdtempSync(join(tmpdir(), 'bcn-fingerprint-a-'))
    const secondDirectory = mkdtempSync(join(tmpdir(), 'bcn-fingerprint-b-'))
    const alteredDirectory = mkdtempSync(join(tmpdir(), 'bcn-fingerprint-altered-'))
    const directories = [firstDirectory, secondDirectory, alteredDirectory]
    try {
      const first = writePackedFixture(firstDirectory)
      const second = writePackedFixture(secondDirectory)
      const altered = writePackedFixture(alteredDirectory, 'export const changed = true\n')
      const expected = derivePackageRuntimeFingerprint('nuxt', version, first.tarball)
      expect(derivePackageRuntimeFingerprint('nuxt', version, second.tarball)).toBe(expected)
      expect(derivePackageRuntimeFingerprint('nuxt', version, altered.tarball)).not.toBe(expected)
      expect(derivePackageRuntimeFingerprint('nuxt', '0.8.0-beta.34', first.tarball)).not.toBe(
        expected,
      )
      expect(derivePackageRuntimeFingerprint('vue', version, 'not-read')).toBeNull()
      expect(derivePackageRuntimeFingerprint('mcp', '0.1.0-beta.21', 'not-read')).toBeNull()

      expect(bindPackageRuntimeFingerprintBuild('nuxt', expected, first.packageRoot)).toBe(expected)
      expect(
        readFileSync(join(first.packageRoot, 'dist/runtime/shared/release-fingerprint.js'), 'utf8'),
      ).toBe(`const value = '${expected}'\n`)
      tar.c(
        {
          cwd: directories[0],
          file: first.tarball,
          gzip: true,
          noDirRecurse: true,
          portable: true,
          strict: true,
          sync: true,
        },
        [
          'package/dist/module.mjs',
          'package/dist/runtime/shared/release-fingerprint.js',
          'package/package.json',
        ],
      )
      expect(assertPackedRuntimeFingerprintBinding('nuxt', version, first.tarball)).toBe(expected)
    } finally {
      for (const directory of directories) rmSync(directory, { force: true, recursive: true })
    }
  })

  it('requires null evidence for a library-only forbidden profile', () => {
    const selected = getPackageRuntimeFingerprintProfile('vue')
    expect(selected.descriptor.profiles.runtimeFingerprint).toBe('vue-no-runtime-fingerprint')
    expect(selected.profile).toEqual({ mode: 'forbidden' })
    const profile = selected.profile
    expect(() => assertRuntimeFingerprintEvidence(profile, null)).not.toThrow()
    for (const value of [
      undefined,
      '',
      '__BCN_RELEASE_RUNTIME_FINGERPRINT__',
      `bcn-release-v1-${'a'.repeat(64)}`,
    ]) {
      expect(() => assertRuntimeFingerprintEvidence(profile, value), String(value)).toThrow(
        'Runtime fingerprint is forbidden',
      )
    }
  })

  it('forbids a runtime fingerprint in the MCP library package', () => {
    const selected = getPackageRuntimeFingerprintProfile('mcp')
    expect(selected.descriptor.profiles.runtimeFingerprint).toBe('mcp-no-runtime-fingerprint')
    expect(selected.profile).toEqual({ mode: 'forbidden' })
    expect(() => assertRuntimeFingerprintEvidence(selected.profile, null)).not.toThrow()
  })

  it('rejects permissive or malformed profile shapes', () => {
    expect(() => assertRuntimeFingerprintProfile({ mode: 'optional' })).toThrow(
      'Required runtime-fingerprint profile is invalid',
    )
    expect(() =>
      assertRuntimeFingerprintProfile({
        mode: 'forbidden',
        token: 'unexpected',
      }),
    ).toThrow('Forbidden runtime-fingerprint profile is invalid')
    expect(() => getPackageRuntimeFingerprintProfile('not-reviewed')).toThrow(
      'Unknown package certification descriptor: not-reviewed',
    )
  })
})
