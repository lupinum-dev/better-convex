import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import * as tar from 'tar'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalNpmTarballFilename,
  getPackageArtifactCoordinates,
} from '../../scripts/package-artifact-coordinates.mjs'
import {
  buildContentManifest,
  inspectTarballArchive,
} from '../../scripts/package-check/tarball.mjs'
import { derivePackageRuntimeFingerprint } from '../../scripts/package-runtime-fingerprint-profile.mjs'

const root = resolve(import.meta.dirname, '../..')
const temporaryDirectories: string[] = []
let productionSbom: string | undefined

function writeFixtureTarball(file: string, packedRoot: string) {
  const files: string[] = []
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) collect(absolutePath)
      else files.push(absolutePath.slice(packedRoot.length + 1))
    }
  }
  collect(join(packedRoot, 'package'))
  tar.c(
    {
      cwd: packedRoot,
      file,
      gzip: true,
      noDirRecurse: true,
      portable: true,
      strict: true,
      sync: true,
    },
    files.sort(),
  )
}

function bindFixtureTarball(file: string, packedRoot: string, version: string) {
  const fingerprintPath = join(packedRoot, 'package/dist/runtime/shared/release-fingerprint.js')
  const source = readFileSync(fingerprintPath, 'utf8').replace(
    /__BCN_RELEASE_RUNTIME_FINGERPRINT__|bcn-release-v1-[0-9a-f]{64}/u,
    '__BCN_RELEASE_RUNTIME_FINGERPRINT__',
  )
  writeFileSync(fingerprintPath, source)
  writeFixtureTarball(file, packedRoot)
  const runtimeFingerprint = derivePackageRuntimeFingerprint('nuxt', version, file)
  if (!runtimeFingerprint) throw new Error('Nuxt fixture requires a runtime fingerprint')
  writeFileSync(
    fingerprintPath,
    source.replace('__BCN_RELEASE_RUNTIME_FINGERPRINT__', runtimeFingerprint),
  )
  writeFixtureTarball(file, packedRoot)
  return runtimeFingerprint
}

function contentManifest(tarballPath: string, packageDir: string) {
  return buildContentManifest(packageDir, inspectTarballArchive('nuxt', tarballPath))
}

function sha256(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sri(bytes: Buffer | string) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function canonicalProductionSbom() {
  if (productionSbom) return productionSbom
  const directory = mkdtempSync(join(tmpdir(), 'bcn-release-test-sbom-'))
  const path = join(directory, 'expected.sbom.cdx.json')
  try {
    execFileSync(
      process.execPath,
      ['scripts/generate-sbom.mjs', '--package', 'nuxt', '--output', path],
      {
        cwd: root,
        stdio: 'ignore',
      },
    )
    productionSbom = readFileSync(path, 'utf8')
    return productionSbom
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

function createArtifactFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'bcn-release-evidence-'))
  temporaryDirectories.push(directory)
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const coordinates = getPackageArtifactCoordinates('nuxt', { repositoryRoot: root })
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
  const pnpm = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
  const tarballName = canonicalNpmTarballFilename(packageJson.name, packageJson.version)
  const contentsName = 'contents.json'
  const sbomName = 'sbom.cdx.json'
  const packedPackage = join(directory, 'packed', 'package')
  mkdirSync(join(packedPackage, 'dist', 'runtime', 'shared'), { recursive: true })
  writeFileSync(
    join(packedPackage, 'dist', 'module.mjs'),
    "import { getPackedRuntimeFingerprint } from '../dist/runtime/shared/release-fingerprint.js'\ngetPackedRuntimeFingerprint()\n",
  )
  writeFileSync(
    join(packedPackage, 'dist', 'runtime', 'shared', 'release-fingerprint.js'),
    "const value = '__BCN_RELEASE_RUNTIME_FINGERPRINT__'\n",
  )
  writeFileSync(join(packedPackage, 'package.json'), `${JSON.stringify(packageJson)}\n`)
  const runtimeFingerprint = bindFixtureTarball(
    join(directory, tarballName),
    join(directory, 'packed'),
    packageJson.version,
  )
  const tarball = readFileSync(join(directory, tarballName))
  const extractedRoot = join(directory, 'extracted')
  mkdirSync(extractedRoot)
  tar.x({ cwd: extractedRoot, file: join(directory, tarballName), strict: true, sync: true })
  const contents = `${JSON.stringify(contentManifest(join(directory, tarballName), join(extractedRoot, 'package')), null, 2)}\n`
  const sbom = canonicalProductionSbom()
  writeFileSync(join(directory, contentsName), contents)
  writeFileSync(join(directory, sbomName), sbom)

  const evidence = {
    schemaVersion: 3,
    packageId: coordinates.packageId,
    packageName: coordinates.packageName,
    packageDirectory: coordinates.packageDirectory,
    version: coordinates.version,
    profiles: structuredClone(coordinates.profiles),
    sourceCommit,
    packageManager: packageJson.packageManager,
    node: process.version,
    npm,
    pnpm,
    sourceTree: 'clean',
    runtimeFingerprint,
    tarball: {
      file: tarballName,
      bytes: tarball.length,
      sha256: sha256(tarball),
      integrity: sri(tarball),
    },
    contents: {
      file: contentsName,
      bytes: Buffer.byteLength(contents),
      sha256: sha256(contents),
    },
    sbom: {
      file: sbomName,
      bytes: Buffer.byteLength(sbom),
      sha256: sha256(sbom),
    },
  }
  const evidencePath = join(directory, 'artifact.json')
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  return { directory, evidence, evidencePath, packedPackage, tarballName }
}

function replaceBoundSidecar(
  fixture: ReturnType<typeof createArtifactFixture>,
  key: 'contents' | 'sbom',
  contents: string,
) {
  writeFileSync(join(fixture.directory, fixture.evidence[key].file), contents)
  fixture.evidence[key].bytes = Buffer.byteLength(contents)
  fixture.evidence[key].sha256 = sha256(contents)
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`)
}

function writeEvidence(fixture: ReturnType<typeof createArtifactFixture>) {
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`)
}

function replacePackedManifest(
  fixture: ReturnType<typeof createArtifactFixture>,
  mutate: (manifest: Record<string, unknown>) => void,
) {
  const manifestPath = join(fixture.packedPackage, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  mutate(manifest)
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)

  const tarballPath = join(fixture.directory, fixture.tarballName)
  fixture.evidence.runtimeFingerprint = bindFixtureTarball(
    tarballPath,
    join(fixture.directory, 'packed'),
    fixture.evidence.version,
  )
  const tarball = readFileSync(tarballPath)
  fixture.evidence.tarball.bytes = tarball.length
  fixture.evidence.tarball.sha256 = sha256(tarball)
  fixture.evidence.tarball.integrity = sri(tarball)

  const contents = `${JSON.stringify(contentManifest(tarballPath, fixture.packedPackage), null, 2)}\n`
  writeFileSync(join(fixture.directory, fixture.evidence.contents.file), contents)
  fixture.evidence.contents.bytes = Buffer.byteLength(contents)
  fixture.evidence.contents.sha256 = sha256(contents)
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`)
}

function productionContractDigest(sbom: Record<string, unknown>) {
  const metadata = sbom.metadata as Record<string, unknown>
  const component = metadata.component as Record<string, unknown>
  const properties = component.properties as Array<{ name: string; value: string }>
  return properties.find(
    ({ name }) => name === 'better-convex-nuxt:production-manifest-contract-sha256',
  )?.value
}

function verify(path: string) {
  return spawnSync('node', ['scripts/release.mjs', 'verify', path], {
    cwd: root,
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('immutable release artifact evidence', () => {
  it('accepts matching tarball, content manifest, SBOM, package, and source commit', () => {
    const fixture = createArtifactFixture()
    expect(fixture.evidence).toMatchObject({
      schemaVersion: 3,
      packageId: 'nuxt',
      packageName: 'better-convex-nuxt',
      packageDirectory: '.',
      version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      profiles: {
        build: 'nuxt-module-build',
        exports: 'nuxt-public-entries',
        packedFiles: 'nuxt-runtime-artifact',
        sbom: 'nuxt-production-dependencies',
        provenance: 'nuxt-auth-upstream',
        candidateTests: 'nuxt-maintained-consumers',
        runtimeFingerprint: 'nuxt-runtime-binding',
      },
    })
    const contents = JSON.parse(
      readFileSync(join(fixture.directory, fixture.evidence.contents.file), 'utf8'),
    )
    expect(contents.files.map((file: { path: string }) => file.path)).toEqual([
      'dist/module.mjs',
      'dist/runtime/shared/release-fingerprint.js',
      'package.json',
    ])
    const result = verify(fixture.evidencePath)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Verified immutable artifact')
    const sbom = JSON.parse(
      readFileSync(join(fixture.directory, fixture.evidence.sbom.file), 'utf8'),
    ) as Record<string, unknown>
    expect(productionContractDigest(sbom)).toMatch(/^[0-9a-f]{64}$/u)
  }, 120_000)

  it.each([
    ['packageId', 'unreviewed'],
    ['packageName', '@attacker/forged'],
    ['packageDirectory', 'packages/forged'],
    ['version', '9.9.9'],
  ] as const)(
    'rejects drifted package identity field %s',
    (field, value) => {
      const fixture = createArtifactFixture()
      const evidence = fixture.evidence as unknown as Record<string, unknown>
      evidence[field] = value
      writeEvidence(fixture)

      const result = verify(fixture.evidencePath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Artifact identity does not match the checked-out package and source commit',
      )
    },
    120_000,
  )

  it.each([
    ['packageManager', 'pnpm@0.0.0-forged'],
    ['node', 'v0.0.0-forged'],
    ['npm', '0.0.0-forged'],
    ['pnpm', '0.0.0-forged'],
    ['sourceTree', 'dirty'],
  ] as const)(
    'rejects drifted build identity field %s',
    (field, value) => {
      const fixture = createArtifactFixture()
      const evidence = fixture.evidence as unknown as Record<string, unknown>
      evidence[field] = value
      writeEvidence(fixture)

      const result = verify(fixture.evidencePath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Artifact identity does not match the checked-out package and source commit',
      )
    },
    120_000,
  )

  it.each([
    'build',
    'exports',
    'packedFiles',
    'sbom',
    'provenance',
    'candidateTests',
    'runtimeFingerprint',
  ] as const)(
    'rejects drifted %s certification profile',
    (profile) => {
      const fixture = createArtifactFixture()
      fixture.evidence.profiles[profile] = 'unreviewed-profile'
      writeEvidence(fixture)

      const result = verify(fixture.evidencePath)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Artifact identity does not match the checked-out package and source commit',
      )
    },
    120_000,
  )

  it('rejects legacy, missing, extra, and malformed identity fields', () => {
    const legacy = createArtifactFixture()
    legacy.evidence.schemaVersion = 2
    writeEvidence(legacy)
    expect(verify(legacy.evidencePath).stderr).toContain('Artifact identity does not match')

    const missing = createArtifactFixture()
    delete (missing.evidence as unknown as Partial<Record<string, unknown>>).packageDirectory
    writeEvidence(missing)
    expect(verify(missing.evidencePath).stderr).toContain('Artifact identity does not match')

    const extra = createArtifactFixture()
    Object.assign(extra.evidence, { publishCommand: 'npm publish forged.tgz' })
    writeEvidence(extra)
    expect(verify(extra.evidencePath).stderr).toContain('Artifact identity does not match')

    const missingProfile = createArtifactFixture()
    delete (missingProfile.evidence.profiles as Partial<typeof missingProfile.evidence.profiles>)
      .build
    writeEvidence(missingProfile)
    expect(verify(missingProfile.evidencePath).stderr).toContain('Artifact identity does not match')

    const extraProfile = createArtifactFixture()
    Object.assign(extraProfile.evidence.profiles, { publish: 'unreviewed-profile' })
    writeEvidence(extraProfile)
    expect(verify(extraProfile.evidencePath).stderr).toContain('Artifact identity does not match')

    const malformedProfiles = createArtifactFixture()
    const malformedEvidence = malformedProfiles.evidence as unknown as Record<string, unknown>
    malformedEvidence.profiles = null
    writeEvidence(malformedProfiles)
    expect(verify(malformedProfiles.evidencePath).stderr).toContain(
      'Artifact identity does not match',
    )
  }, 120_000)

  it('rejects missing or extra fields in nested file evidence', () => {
    const extraTarball = createArtifactFixture()
    Object.assign(extraTarball.evidence.tarball, { sourcePath: '/tmp/unreviewed.tgz' })
    writeEvidence(extraTarball)
    expect(verify(extraTarball.evidencePath).stderr).toContain(
      'Artifact tarball evidence is malformed',
    )

    const extraContents = createArtifactFixture()
    Object.assign(extraContents.evidence.contents, { integrity: 'sha512-unreviewed' })
    writeEvidence(extraContents)
    expect(verify(extraContents.evidencePath).stderr).toContain(
      'Artifact content manifest evidence is malformed',
    )

    const missingSbom = createArtifactFixture()
    delete (missingSbom.evidence.sbom as Partial<typeof missingSbom.evidence.sbom>).sha256
    writeEvidence(missingSbom)
    expect(verify(missingSbom.evidencePath).stderr).toContain('Artifact SBOM evidence is malformed')

    const truncatedIntegrity = createArtifactFixture()
    truncatedIntegrity.evidence.tarball.integrity = 'sha512-A'
    writeEvidence(truncatedIntegrity)
    expect(verify(truncatedIntegrity.evidencePath).stderr).toContain(
      'Artifact tarball evidence is malformed',
    )
  }, 120_000)

  it('rejects evidence supplied under any basename other than artifact.json', () => {
    const fixture = createArtifactFixture()
    const renamedEvidencePath = join(fixture.directory, 'candidate-artifact.json')
    renameSync(fixture.evidencePath, renamedEvidencePath)

    const result = verify(renamedEvidencePath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Artifact evidence must be a regular artifact.json file')
  }, 120_000)

  it('rejects symlinked evidence and sidecars even when their target bytes match', () => {
    const evidenceFixture = createArtifactFixture()
    const evidenceTarget = join(evidenceFixture.directory, 'artifact-target.json')
    renameSync(evidenceFixture.evidencePath, evidenceTarget)
    symlinkSync(evidenceTarget, evidenceFixture.evidencePath)
    expect(verify(evidenceFixture.evidencePath).stderr).toContain(
      'Artifact evidence must be a regular artifact.json file',
    )

    const tarballFixture = createArtifactFixture()
    const tarballPath = join(tarballFixture.directory, tarballFixture.evidence.tarball.file)
    const tarballTarget = join(tarballFixture.directory, 'tarball-target.tgz')
    renameSync(tarballPath, tarballTarget)
    symlinkSync(tarballTarget, tarballPath)
    expect(verify(tarballFixture.evidencePath).stderr).toContain(
      'Artifact tarball bytes do not match their evidence',
    )

    const contentsFixture = createArtifactFixture()
    const contentsPath = join(contentsFixture.directory, contentsFixture.evidence.contents.file)
    const contentsTarget = join(contentsFixture.directory, 'contents-target.json')
    renameSync(contentsPath, contentsTarget)
    symlinkSync(contentsTarget, contentsPath)
    expect(verify(contentsFixture.evidencePath).stderr).toContain(
      'Artifact content manifest bytes do not match their evidence',
    )

    const sbomFixture = createArtifactFixture()
    const sbomPath = join(sbomFixture.directory, sbomFixture.evidence.sbom.file)
    const sbomTarget = join(sbomFixture.directory, 'sbom-target.cdx.json')
    renameSync(sbomPath, sbomTarget)
    symlinkSync(sbomTarget, sbomPath)
    expect(verify(sbomFixture.evidencePath).stderr).toContain(
      'Artifact SBOM bytes do not match their evidence',
    )
  }, 120_000)

  it('roots the SBOM contract digest in the explicitly supplied package manifest', () => {
    const fixture = createArtifactFixture()
    const original = JSON.parse(
      readFileSync(join(fixture.directory, fixture.evidence.sbom.file), 'utf8'),
    ) as Record<string, unknown>
    const manifestPath = join(fixture.packedPackage, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.peerDependencies = {
      ...(manifest.peerDependencies as Record<string, unknown>),
      'candidate-consumer-peer': '1.0.0',
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
    const outputPath = join(fixture.directory, 'candidate-rooted.sbom.cdx.json')
    execFileSync(
      process.execPath,
      [
        'scripts/generate-sbom.mjs',
        '--package',
        'nuxt',
        '--root-manifest',
        manifestPath,
        '--output',
        outputPath,
      ],
      { cwd: root, stdio: 'ignore' },
    )
    const candidate = JSON.parse(readFileSync(outputPath, 'utf8')) as Record<string, unknown>
    expect(productionContractDigest(candidate)).toMatch(/^[0-9a-f]{64}$/u)
    expect(productionContractDigest(candidate)).not.toBe(productionContractDigest(original))
    expect(
      (candidate.components as Array<Record<string, unknown>>).some(
        (component) => component.name === 'candidate-consumer-peer',
      ),
    ).toBe(true)
  }, 120_000)

  it('rejects a rehashed tarball whose packed production contract differs from source', () => {
    const fixture = createArtifactFixture()
    replacePackedManifest(fixture, (manifest) => {
      manifest.dependencies = {
        ...(manifest.dependencies as Record<string, unknown>),
        defu: '0.0.0-forged',
      }
      manifest.peerDependencies = {
        ...(manifest.peerDependencies as Record<string, unknown>),
        convex: '0.0.0-forged',
      }
      manifest.engines = { node: '>=0' }
    })
    const result = verify(fixture.evidencePath)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain(
      'Packed production manifest contract does not exactly match the reviewed source manifest',
    )
  }, 120_000)

  it('rejects a rehashed tarball whose only manifest drift is an added export', () => {
    const fixture = createArtifactFixture()
    replacePackedManifest(fixture, (manifest) => {
      ;(manifest.exports as Record<string, unknown>)['./forged'] = './dist/forged.js'
    })
    const result = verify(fixture.evidencePath)
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain(
      'Packed production manifest contract does not exactly match the reviewed source manifest',
    )
  }, 120_000)

  it('rejects a rehashed tarball whose packed package identity differs from source', () => {
    const fixture = createArtifactFixture()
    replacePackedManifest(fixture, (manifest) => {
      manifest.name = 'forged-package-name'
    })
    const result = verify(fixture.evidencePath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Packed package identity forged-package-name@')
  }, 120_000)

  it('rejects changed tarball bytes', () => {
    const fixture = createArtifactFixture()
    writeFileSync(join(fixture.directory, fixture.tarballName), 'different bytes')
    const result = verify(fixture.evidencePath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('tarball bytes do not match')
  }, 120_000)

  it('rejects changed sidecars and a forged tarball integrity value', () => {
    const contentsFixture = createArtifactFixture()
    writeFileSync(join(contentsFixture.directory, contentsFixture.evidence.contents.file), '{}\n')
    expect(verify(contentsFixture.evidencePath).stderr).toContain(
      'content manifest bytes do not match',
    )

    const sbomFixture = createArtifactFixture()
    writeFileSync(join(sbomFixture.directory, sbomFixture.evidence.sbom.file), '{}\n')
    expect(verify(sbomFixture.evidencePath).stderr).toContain('SBOM bytes do not match')

    const integrityFixture = createArtifactFixture()
    integrityFixture.evidence.tarball.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`
    writeFileSync(
      integrityFixture.evidencePath,
      `${JSON.stringify(integrityFixture.evidence, null, 2)}\n`,
    )
    expect(verify(integrityFixture.evidencePath).stderr).toContain('tarball SRI does not match')
  }, 120_000)

  it('rejects a bound content manifest that does not describe the tarball', () => {
    const fixture = createArtifactFixture()
    const contents = JSON.parse(
      readFileSync(join(fixture.directory, fixture.evidence.contents.file), 'utf8'),
    )
    contents.files = contents.files.slice(1)
    replaceBoundSidecar(fixture, 'contents', `${JSON.stringify(contents, null, 2)}\n`)
    expect(verify(fixture.evidencePath).stderr).toContain(
      'content manifest does not exactly match the tarball contents',
    )
  }, 120_000)

  it('rejects a bound SBOM that differs from the production dependency contract', () => {
    const fixture = createArtifactFixture()
    const sbom = JSON.parse(
      readFileSync(join(fixture.directory, fixture.evidence.sbom.file), 'utf8'),
    )
    expect(sbom.components.length).toBeGreaterThan(0)
    sbom.components[0].version = '0.0.0-forged'
    replaceBoundSidecar(fixture, 'sbom', `${JSON.stringify(sbom, null, 2)}\n`)
    expect(verify(fixture.evidencePath).stderr).toContain(
      'SBOM does not match the canonical production dependency contract',
    )
  }, 120_000)

  it('rejects traversal and a source-commit mismatch', () => {
    const fixture = createArtifactFixture()
    fixture.evidence.tarball.file = '../outside.tgz'
    writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence)}\n`)
    expect(verify(fixture.evidencePath).stderr).toContain('tarball evidence is malformed')

    const second = createArtifactFixture()
    second.evidence.sourceCommit = '0'.repeat(40)
    writeFileSync(second.evidencePath, `${JSON.stringify(second.evidence)}\n`)
    expect(verify(second.evidencePath).stderr).toContain('identity does not match')
  }, 120_000)

  it('rejects control characters and arbitrary suffixes in evidence filenames', () => {
    const injected = createArtifactFixture()
    injected.evidence.tarball.file = `${injected.tarballName}\noutput=.`
    writeFileSync(injected.evidencePath, `${JSON.stringify(injected.evidence)}\n`)
    expect(verify(injected.evidencePath).stderr).toContain('tarball evidence is malformed')

    const suffixed = createArtifactFixture()
    suffixed.evidence.contents.file = `${suffixed.evidence.contents.file}.old`
    writeFileSync(suffixed.evidencePath, `${JSON.stringify(suffixed.evidence)}\n`)
    expect(verify(suffixed.evidencePath).stderr).toContain('content manifest evidence is malformed')
  }, 120_000)

  it('rejects missing or malformed build-generated runtime fingerprints', () => {
    const missing = createArtifactFixture()
    delete (missing.evidence as { runtimeFingerprint?: string }).runtimeFingerprint
    writeFileSync(missing.evidencePath, `${JSON.stringify(missing.evidence)}\n`)
    expect(verify(missing.evidencePath).stderr).toContain('identity does not match')

    const forged = createArtifactFixture()
    forged.evidence.runtimeFingerprint = `bcn-release-v1-${'g'.repeat(64)}`
    writeFileSync(forged.evidencePath, `${JSON.stringify(forged.evidence)}\n`)
    expect(verify(forged.evidencePath).stderr).toContain('identity does not match')

    const mismatched = createArtifactFixture()
    mismatched.evidence.runtimeFingerprint = `bcn-release-v1-${'b'.repeat(64)}`
    writeFileSync(mismatched.evidencePath, `${JSON.stringify(mismatched.evidence)}\n`)
    expect(verify(mismatched.evidencePath).stderr).toContain(
      'runtime fingerprint does not match its deterministic coordinate',
    )
  }, 120_000)
})
