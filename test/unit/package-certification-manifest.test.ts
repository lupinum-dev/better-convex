import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getPackageCertificationDescriptor,
  packageCertificationDescriptors,
  validatePackageCertificationDescriptors,
} from '../../scripts/package-certification-manifest.mjs'

const temporaryDirectories: string[] = []
const repository = {
  type: 'git',
  url: 'https://github.com/lupinum-dev/better-convex-nuxt',
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createRepository(
  name = '@lupinum/better-convex-nuxt',
  options: { directory?: string; private?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'bcn-certification-manifest-'))
  temporaryDirectories.push(root)
  const packageDirectory = options.directory ?? '.'
  const absolutePackageDirectory = packageDirectory === '.' ? root : join(root, packageDirectory)
  mkdirSync(absolutePackageDirectory, { recursive: true })
  writeFileSync(
    join(absolutePackageDirectory, 'package.json'),
    `${JSON.stringify({ name, private: options.private, repository, version: '1.0.0' })}\n`,
  )
  const vuePackageDirectory = join(root, 'packages/vue')
  mkdirSync(vuePackageDirectory, { recursive: true })
  writeFileSync(
    join(vuePackageDirectory, 'package.json'),
    `${JSON.stringify({ name: '@lupinum/better-convex-vue', repository, version: '1.0.0' })}\n`,
  )
  const mcpPackageDirectory = join(root, 'packages/mcp')
  mkdirSync(mcpPackageDirectory, { recursive: true })
  writeFileSync(
    join(mcpPackageDirectory, 'package.json'),
    `${JSON.stringify({ name: '@lupinum/better-convex-mcp', repository, version: '1.0.0' })}\n`,
  )
  return root
}

function cloneDescriptor() {
  return structuredClone(packageCertificationDescriptors[0])
}

function cloneDescriptors(replacement = cloneDescriptor()) {
  return [
    replacement,
    structuredClone(packageCertificationDescriptors[1]),
    structuredClone(packageCertificationDescriptors[2]),
  ]
}

describe('package certification manifest', () => {
  it('authorizes exactly the reviewed Nuxt, Vue, and MCP packages with closed profile tuples', () => {
    expect(packageCertificationDescriptors).toEqual([
      {
        id: 'nuxt',
        packageName: '@lupinum/better-convex-nuxt',
        packageDirectory: '.',
        profiles: {
          build: 'nuxt-module-build',
          exports: 'nuxt-public-entries',
          packedFiles: 'nuxt-runtime-artifact',
          sbom: 'nuxt-production-dependencies',
          provenance: 'nuxt-auth-upstream',
          candidateTests: 'nuxt-maintained-consumers',
          runtimeFingerprint: 'nuxt-runtime-binding',
        },
      },
      {
        id: 'vue',
        packageName: '@lupinum/better-convex-vue',
        packageDirectory: 'packages/vue',
        profiles: {
          build: 'vue-unbuild',
          exports: 'vue-public-entries',
          packedFiles: 'vue-runtime-artifact',
          sbom: 'vue-production-dependencies',
          provenance: 'vue-repository-origin',
          candidateTests: 'vue-maintained-consumers',
          runtimeFingerprint: 'vue-no-runtime-fingerprint',
        },
      },
      {
        id: 'mcp',
        packageName: '@lupinum/better-convex-mcp',
        packageDirectory: 'packages/mcp',
        profiles: {
          build: 'mcp-unbuild',
          exports: 'mcp-public-entries',
          packedFiles: 'mcp-runtime-artifact',
          sbom: 'mcp-production-dependencies',
          provenance: 'mcp-repository-origin',
          candidateTests: 'mcp-maintained-consumers',
          runtimeFingerprint: 'mcp-no-runtime-fingerprint',
        },
      },
    ])
    expect(Object.isFrozen(packageCertificationDescriptors)).toBe(true)
    expect(Object.isFrozen(packageCertificationDescriptors[0])).toBe(true)
    expect(Object.isFrozen(packageCertificationDescriptors[0].profiles)).toBe(true)
    expect(getPackageCertificationDescriptor('nuxt')).toBe(packageCertificationDescriptors[0])
    expect(getPackageCertificationDescriptor('vue')).toBe(packageCertificationDescriptors[1])
    expect(getPackageCertificationDescriptor('mcp')).toBe(packageCertificationDescriptors[2])
  })

  it.each(['react', '@lupinum/better-convex-nuxt', '.', '../playground', 'packages/vue', 'NUXT'])(
    'rejects unknown or path-like selector %j',
    (selector) => {
      expect(() => getPackageCertificationDescriptor(selector)).toThrow(
        `Unknown package certification descriptor: ${selector}`,
      )
    },
  )

  it('requires a non-empty array of exact descriptor and profile objects', () => {
    const root = createRepository()
    expect(() => validatePackageCertificationDescriptors(null, { repositoryRoot: root })).toThrow(
      'must be a non-empty array',
    )
    expect(() => validatePackageCertificationDescriptors([], { repositoryRoot: root })).toThrow(
      'must be a non-empty array',
    )

    const extraDescriptor = { ...cloneDescriptor(), command: 'npm publish' }
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(extraDescriptor), {
        repositoryRoot: root,
      }),
    ).toThrow('descriptor nuxt: unexpected fields: command')

    const missingProfile = cloneDescriptor()
    delete (missingProfile.profiles as Partial<typeof missingProfile.profiles>).sbom
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(missingProfile), {
        repositoryRoot: root,
      }),
    ).toThrow('descriptor nuxt profiles: missing fields: sbom')

    const extraProfile = cloneDescriptor()
    Object.assign(extraProfile.profiles, {
      command: 'node scripts/release.mjs',
    })
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(extraProfile), {
        repositoryRoot: root,
      }),
    ).toThrow('descriptor nuxt profiles: unexpected fields: command')
  })

  it.each([
    'build',
    'exports',
    'packedFiles',
    'sbom',
    'provenance',
    'candidateTests',
    'runtimeFingerprint',
  ] as const)('rejects an unreviewed %s profile', (profile) => {
    const root = createRepository()
    const descriptor = cloneDescriptor()
    descriptor.profiles[profile] = 'unreviewed-profile'
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(descriptor), {
        repositoryRoot: root,
      }),
    ).toThrow(`descriptor nuxt has unreviewed ${profile} profile`)
  })

  it('rejects a profile ID reviewed for a different category', () => {
    const root = createRepository()
    const descriptor = cloneDescriptor()
    descriptor.profiles.build = descriptor.profiles.exports
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(descriptor), {
        repositoryRoot: root,
      }),
    ).toThrow('descriptor nuxt has unreviewed build profile')
  })

  it.each([
    ['id', 'Nuxt'],
    ['id', 'nuxt/other'],
    ['packageName', 'Better Convex Nuxt'],
    ['packageName', '../better-convex-nuxt'],
  ] as const)('rejects malformed %s identity value %j', (field, value) => {
    const root = createRepository()
    const descriptor = { ...cloneDescriptor(), [field]: value }
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(descriptor), {
        repositoryRoot: root,
      }),
    ).toThrow(`has invalid ${field}`)
  })

  it.each([
    '',
    '/',
    '/tmp/package',
    '..',
    '../package',
    'playground',
    'packages',
    'packages/../playground',
    'packages/vue/child',
    'packages\\vue',
    'packages/%2e%2e',
    'packages/vue/',
  ])('rejects non-canonical package directory %j', (packageDirectory) => {
    const root = createRepository()
    const descriptor = { ...cloneDescriptor(), packageDirectory }
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(descriptor), {
        repositoryRoot: root,
      }),
    ).toThrow('descriptor nuxt has invalid packageDirectory')
  })

  it('rejects duplicate descriptor identities before filesystem resolution', () => {
    const root = createRepository()
    const descriptor = cloneDescriptor()
    expect(() =>
      validatePackageCertificationDescriptors([descriptor, cloneDescriptor()], {
        repositoryRoot: root,
      }),
    ).toThrow('duplicate descriptor id: nuxt')

    expect(() =>
      validatePackageCertificationDescriptors(
        [descriptor, { ...cloneDescriptor(), id: 'vue', packageDirectory: 'packages/vue' }],
        { repositoryRoot: root },
      ),
    ).toThrow('duplicate package name: @lupinum/better-convex-nuxt')

    expect(() =>
      validatePackageCertificationDescriptors(
        [
          descriptor,
          {
            ...cloneDescriptor(),
            id: 'vue',
            packageName: '@lupinum/better-convex-vue',
          },
        ],
        { repositoryRoot: root },
      ),
    ).toThrow('duplicate package directory: .')
  })

  it('binds the reviewed identity to a real in-repository package manifest', () => {
    const wrongNameRoot = createRepository('renamed-package')
    expect(() =>
      getPackageCertificationDescriptor('nuxt', {
        repositoryRoot: wrongNameRoot,
      }),
    ).toThrow('declares renamed-package; descriptor nuxt requires @lupinum/better-convex-nuxt')
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(), {
        repositoryRoot: wrongNameRoot,
      }),
    ).toThrow('declares renamed-package; descriptor nuxt requires @lupinum/better-convex-nuxt')

    const privateRoot = createRepository('@lupinum/better-convex-nuxt', {
      private: true,
    })
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(), {
        repositoryRoot: privateRoot,
      }),
    ).toThrow('descriptor nuxt cannot certify a private package')

    const missingRepositoryRoot = createRepository()
    writeFileSync(
      join(missingRepositoryRoot, 'package.json'),
      `${JSON.stringify({ name: '@lupinum/better-convex-nuxt', version: '1.0.0' })}\n`,
    )
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(), {
        repositoryRoot: missingRepositoryRoot,
      }),
    ).toThrow('requires repository.url')

    const missingRoot = createRepository()
    rmSync(join(missingRoot, 'package.json'))
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(), {
        repositoryRoot: missingRoot,
      }),
    ).toThrow('descriptor nuxt package.json is missing')
  })

  it('rejects jointly drifted package identities and directories', () => {
    const renamedRoot = createRepository('renamed-package')
    const renamedDescriptor = {
      ...cloneDescriptor(),
      packageName: 'renamed-package',
    }
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(renamedDescriptor), {
        repositoryRoot: renamedRoot,
      }),
    ).toThrow('descriptor nuxt has unreviewed packageName')

    const movedRoot = createRepository('@lupinum/better-convex-nuxt', {
      directory: 'packages/rogue',
    })
    const movedDescriptor = {
      ...cloneDescriptor(),
      packageDirectory: 'packages/rogue',
    }
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(movedDescriptor), {
        repositoryRoot: movedRoot,
      }),
    ).toThrow('descriptor nuxt has unreviewed packageDirectory')
  })

  it.each([
    ['{', 'is not valid JSON'],
    ['[]', 'must be a plain object'],
  ])('rejects malformed package manifest %j', (contents, expected) => {
    const root = createRepository()
    writeFileSync(join(root, 'package.json'), `${contents}\n`)
    expect(() =>
      validatePackageCertificationDescriptors(cloneDescriptors(), {
        repositoryRoot: root,
      }),
    ).toThrow(expected)
  })

  it('returns an immutable canonical copy independent from caller mutation', () => {
    const root = createRepository()
    const descriptor = cloneDescriptor()
    const validated = validatePackageCertificationDescriptors(cloneDescriptors(descriptor), {
      repositoryRoot: root,
    })
    descriptor.packageName = 'changed-after-validation'
    descriptor.profiles.build = 'changed-after-validation'

    expect(validated[0].packageName).toBe('@lupinum/better-convex-nuxt')
    expect(validated[0].profiles.build).toBe('nuxt-module-build')
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated[0])).toBe(true)
    expect(Object.isFrozen(validated[0].profiles)).toBe(true)
  })
})
