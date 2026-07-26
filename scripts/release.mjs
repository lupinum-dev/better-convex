import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import {
  assertPackageArtifactWriteTarget,
  assertPackageManifestMatchesCommit,
  getPackageArtifactCoordinates,
} from './package-artifact-coordinates.mjs'
import {
  assertPackageArtifactBuildIdentity,
  packageArtifactEvidenceSchemaVersion,
  parsePackageArtifactEvidence,
} from './package-artifact-evidence.mjs'
import {
  assertProductionManifestContract,
  selectProductionManifestContract,
} from './package-check/production-manifest-contract.mjs'
import { buildContentManifest, packAndExtract } from './package-check/tarball.mjs'
import { getPackageRuntimeFingerprintProfile } from './package-runtime-fingerprint-profile.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const { command, packageId: releasePackageId, verifyPath } = parseArguments(process.argv.slice(2))
const artifactCoordinates = getPackageArtifactCoordinates(releasePackageId)
const packageRoot = artifactCoordinates.sourceDirectory
const packageJson = JSON.parse(readFileSync(artifactCoordinates.manifestPath, 'utf8'))
const workspacePackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const reviewedManifestContract = selectProductionManifestContract(releasePackageId, packageJson)
const workspacePackageManager = workspacePackageJson.packageManager
if (
  typeof workspacePackageManager !== 'string' ||
  workspacePackageManager.length === 0 ||
  (artifactCoordinates.packageDirectory === '.' &&
    reviewedManifestContract.manifest.packageManager !== workspacePackageManager)
) {
  throw new Error('Workspace package.json must declare the release package manager.')
}
const version = artifactCoordinates.version
const tag = `v${version}`
const expectedArtifactFiles = artifactCoordinates.files
const { profile: runtimeFingerprintProfile } = getPackageRuntimeFingerprintProfile(releasePackageId)
const maxPackedFingerprintFileBytes = 16 * 1024 * 1024

function parseArguments(args) {
  const command = args[0]
  if (!['artifact', 'prepare', 'verify'].includes(command)) {
    throw new Error(
      'Usage: node scripts/release.mjs artifact|prepare [--package <reviewed-id>] | verify <artifact.json> [--package <reviewed-id>]',
    )
  }
  const values = new Map()
  const positional = []
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--package') {
      const value = args[index + 1]
      if (!value || value.startsWith('--') || values.has(argument)) {
        throw new Error('--package requires one reviewed package identifier.')
      }
      values.set(argument, value)
      index += 1
      continue
    }
    if (argument.startsWith('--')) throw new Error(`Unknown release argument: ${argument}`)
    positional.push(argument)
  }
  if (
    (command === 'verify' && positional.length !== 1) ||
    (command !== 'verify' && positional.length)
  ) {
    throw new Error(
      'Usage: node scripts/release.mjs artifact|prepare [--package <reviewed-id>] | verify <artifact.json> [--package <reviewed-id>]',
    )
  }
  return {
    command,
    packageId: values.get('--package') ?? 'nuxt',
    verifyPath: positional[0],
  }
}
function run(executable, args, options = {}) {
  console.log(`\n> ${[executable, ...args].join(' ')}`)
  return execFileSync(executable, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
}

function output(executable, args, options = {}) {
  return run(executable, args, { ...options, capture: true }).trim()
}

function ensureCleanWorkingTree() {
  const status = output('git', ['status', '--porcelain'])
  if (status) {
    throw new Error(`Release artifact creation requires a clean working tree:\n${status}`)
  }
}

function requirePreparedChangelog() {
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  if (!changelog.includes(`## ${tag}`)) {
    throw new Error(`CHANGELOG.md must contain a prepared ${tag} release entry.`)
  }
}

function assertReleaseTagIsUnusedOrCurrent(currentCommit) {
  if (output('git', ['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('Release artifact creation requires complete Git history and tags.')
  }
  let taggedCommit
  try {
    taggedCommit = output('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`])
  } catch {
    return
  }
  if (taggedCommit !== currentCommit) {
    throw new Error(
      `Release version ${version} is immutable at ${taggedCommit}; bump the package version before creating another artifact.`,
    )
  }
}

function digest(path, algorithm) {
  return createHash(algorithm).update(readFileSync(path)).digest('hex')
}

function integrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

function fileEvidence(path) {
  return {
    file: basename(path),
    bytes: statSync(path).size,
    sha256: digest(path, 'sha256'),
  }
}

function verifyFileEvidence(directory, evidence, label) {
  if (
    basename(evidence.file) !== evidence.file ||
    !Number.isSafeInteger(evidence.bytes) ||
    evidence.bytes < 1
  ) {
    throw new Error(`Artifact ${label} evidence is malformed.`)
  }
  const path = join(directory, evidence.file)
  if (!existsSync(path)) throw new Error(`Artifact ${label} file is missing: ${path}`)
  const stats = lstatSync(path)
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size !== evidence.bytes ||
    digest(path, 'sha256') !== evidence.sha256
  ) {
    throw new Error(`Artifact ${label} bytes do not match their evidence.`)
  }
  return path
}

function verifyRuntimeFingerprintBinding(tarballPath, runtimeFingerprint) {
  if (runtimeFingerprintProfile.mode === 'forbidden') return
  for (const packagePath of runtimeFingerprintProfile.packedFiles) {
    let source
    try {
      source = execFileSync('tar', ['-xOf', tarballPath, `package/${packagePath}`], {
        encoding: 'utf8',
        maxBuffer: maxPackedFingerprintFileBytes,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error(`Artifact tarball is missing bounded fingerprint input ${packagePath}.`)
    }
    if (
      source.split(runtimeFingerprint).length !== 2 ||
      source.includes(runtimeFingerprintProfile.token)
    ) {
      throw new Error(`Artifact runtime fingerprint is not bound to packed ${packagePath}.`)
    }
  }
  for (const binding of runtimeFingerprintProfile.moduleBindings) {
    let moduleSource
    try {
      moduleSource = execFileSync('tar', ['-xOf', tarballPath, `package/${binding.packedFile}`], {
        encoding: 'utf8',
        maxBuffer: maxPackedFingerprintFileBytes,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error(
        `Artifact tarball is missing bounded fingerprint input ${binding.packedFile}.`,
      )
    }
    const escapedImport = binding.helperImport.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const importPattern = new RegExp(
      `import\\s*\\{\\s*getPackedRuntimeFingerprint\\s*\\}\\s*from\\s*['"]${escapedImport}['"]`,
      'gu',
    )
    const bindings = moduleSource.match(importPattern) ?? []
    if (bindings.length !== 1 || moduleSource.includes(runtimeFingerprintProfile.token)) {
      throw new Error(
        `Artifact runtime fingerprint helper is not bound to packed ${binding.packedFile}.`,
      )
    }
  }
}

function requireReviewedCandidateManifest(packageDir) {
  const manifestPath = join(packageDir, 'package.json')
  const candidate = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (candidate.name !== packageJson.name || candidate.version !== version) {
    throw new Error(
      `Packed package identity ${String(candidate.name)}@${String(candidate.version)} does not match reviewed ${packageJson.name}@${version}.`,
    )
  }
  assertProductionManifestContract(releasePackageId, candidate, packageJson)
  return manifestPath
}

function canonicalizeProductionSbom(value, label) {
  const timestamp = value?.metadata?.timestamp
  let canonicalTimestamp
  try {
    canonicalTimestamp =
      typeof timestamp === 'string' ? new Date(timestamp).toISOString() : undefined
  } catch {
    canonicalTimestamp = undefined
  }
  if (canonicalTimestamp !== timestamp) {
    throw new Error(`Artifact ${label} SBOM timestamp is malformed.`)
  }
  const canonical = structuredClone(value)
  canonical.metadata.timestamp = '<canonical-generated-at>'
  return canonical
}

function verifyProductionSbomContract(sbom, candidateManifestPath) {
  const scratchDir = mkdtempSync(join(tmpdir(), 'bcn-release-sbom-'))
  const expectedPath = join(scratchDir, 'expected.sbom.cdx.json')
  try {
    run('node', [
      'scripts/generate-sbom.mjs',
      '--package',
      releasePackageId,
      '--root-manifest',
      candidateManifestPath,
      '--output',
      expectedPath,
    ])
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
    if (
      !isDeepStrictEqual(
        canonicalizeProductionSbom(sbom, 'candidate'),
        canonicalizeProductionSbom(expected, 'expected'),
      )
    ) {
      throw new Error('Artifact SBOM does not match the canonical production dependency contract.')
    }
  } finally {
    rmSync(scratchDir, { force: true, recursive: true })
  }
}

function generateCandidateSbom(tarballPath, outputPath) {
  const { packageDir, scratchDir } = packAndExtract(releasePackageId, tarballPath)
  try {
    const candidateManifestPath = requireReviewedCandidateManifest(packageDir)
    run('node', [
      'scripts/generate-sbom.mjs',
      '--package',
      releasePackageId,
      '--root-manifest',
      candidateManifestPath,
      '--output',
      outputPath,
    ])
  } finally {
    rmSync(scratchDir, { force: true, recursive: true })
  }
}

function verifyArtifact(evidenceFile) {
  const evidencePath = resolve(repoRoot, evidenceFile)
  const evidenceStats = existsSync(evidencePath) ? lstatSync(evidencePath) : undefined
  if (
    basename(evidencePath) !== expectedArtifactFiles.evidence ||
    !evidenceStats?.isFile() ||
    evidenceStats.isSymbolicLink()
  ) {
    throw new Error(`Artifact evidence must be a regular ${expectedArtifactFiles.evidence} file.`)
  }
  const evidence = parsePackageArtifactEvidence(
    JSON.parse(readFileSync(evidencePath, 'utf8')),
    artifactCoordinates,
  )
  const currentCommit = output('git', ['rev-parse', 'HEAD'])
  const currentNpm = output('npm', ['--version'])
  const currentPnpm = output('pnpm', ['--version'])
  assertPackageArtifactBuildIdentity(evidence, {
    sourceCommit: currentCommit,
    packageManager: workspacePackageManager,
    node: process.version,
    npm: currentNpm,
    pnpm: currentPnpm,
  })
  assertPackageManifestMatchesCommit(releasePackageId, currentCommit)

  const directory = resolve(evidencePath, '..')
  const tarballPath = verifyFileEvidence(directory, evidence.tarball, 'tarball')
  const contentsPath = verifyFileEvidence(directory, evidence.contents, 'content manifest')
  const sbomPath = verifyFileEvidence(directory, evidence.sbom, 'SBOM')
  if (integrity(tarballPath) !== evidence.tarball.integrity) {
    throw new Error('Artifact tarball SRI does not match its bytes.')
  }
  verifyRuntimeFingerprintBinding(tarballPath, evidence.runtimeFingerprint)

  const { packageDir, scratchDir, archiveEntries } = packAndExtract(releasePackageId, tarballPath)
  try {
    const candidateManifestPath = requireReviewedCandidateManifest(packageDir)
    const contents = JSON.parse(readFileSync(contentsPath, 'utf8'))
    const recomputedContents = buildContentManifest(packageDir, archiveEntries)
    if (
      contents.version !== version ||
      !Array.isArray(contents.files) ||
      contents.files.length === 0 ||
      !isDeepStrictEqual(contents, recomputedContents)
    ) {
      throw new Error('Artifact content manifest does not exactly match the tarball contents.')
    }
    const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'))
    verifyProductionSbomContract(sbom, candidateManifestPath)
  } finally {
    rmSync(scratchDir, { force: true, recursive: true })
  }

  console.log(`Verified immutable artifact: ${tarballPath}`)
  console.log(`SHA-256: ${evidence.tarball.sha256}`)
  console.log(`SRI: ${evidence.tarball.integrity}`)
  return { evidence, tarballPath }
}

function packBoundRuntimeArtifact(artifactsDir) {
  const runtimeFingerprint =
    runtimeFingerprintProfile.mode === 'required'
      ? `bcn-release-v1-${randomBytes(32).toString('hex')}`
      : null
  const originals = (
    runtimeFingerprintProfile.mode === 'required' ? runtimeFingerprintProfile.buildFiles : []
  ).map((relativePath) => {
    const path = join(packageRoot, relativePath)
    const source = readFileSync(path, 'utf8')
    if (source.split(runtimeFingerprintProfile.token).length !== 2) {
      throw new Error(`Release fingerprint token must occur exactly once in ${path}.`)
    }
    return { path, source }
  })

  try {
    for (const { path, source } of originals) {
      writeFileSync(path, source.replace(runtimeFingerprintProfile.token, runtimeFingerprint))
    }
    // npm must not rerun prepack here: dist above is the one reviewed build.
    const packResult = JSON.parse(
      output('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', artifactsDir], {
        cwd: packageRoot,
      }),
    )
    if (!Array.isArray(packResult) || packResult.length !== 1) {
      throw new Error('npm pack must produce exactly one package result.')
    }
    return { packResult, runtimeFingerprint }
  } finally {
    // Keep the checkout/build output reusable even when packing fails midway.
    for (const { path, source } of originals) writeFileSync(path, source)
  }
}

/**
 * Builds and packs exactly once. The returned tarball is the only releasable
 * package input; later jobs verify or publish these bytes and never repack the
 * repository directory.
 */
function createArtifact() {
  const distDir = join(packageRoot, 'dist')
  const sourceCommit = output('git', ['rev-parse', 'HEAD'])
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error('Could not resolve source commit.')
  assertReleaseTagIsUnusedOrCurrent(sourceCommit)
  assertPackageManifestMatchesCommit(releasePackageId, sourceCommit)
  assertPackageArtifactWriteTarget(releasePackageId)
  rmSync(distDir, { recursive: true, force: true })
  run('pnpm', ['run', 'prepack'], { cwd: packageRoot })

  assertPackageArtifactWriteTarget(releasePackageId)
  mkdirSync(artifactCoordinates.packageArtifactDirectory, { recursive: true })
  assertPackageArtifactWriteTarget(releasePackageId)
  const stagingDirectory = mkdtempSync(
    join(artifactCoordinates.packageArtifactDirectory, `.tmp-${version}-`),
  )
  let committed = false
  try {
    const { packResult, runtimeFingerprint } = packBoundRuntimeArtifact(stagingDirectory)
    if (packResult[0].filename !== expectedArtifactFiles.tarball) {
      throw new Error(
        `npm pack produced unexpected artifact filename: ${String(packResult[0].filename)}.`,
      )
    }
    if (packResult[0].name !== packageJson.name || packResult[0].version !== version) {
      throw new Error(
        `npm pack produced unexpected identity: ${String(packResult[0].name)}@${String(packResult[0].version)}.`,
      )
    }
    const tarballPath = join(stagingDirectory, packResult[0].filename)
    if (!existsSync(tarballPath)) throw new Error(`Expected tarball is missing: ${tarballPath}`)

    const contentsPath = join(stagingDirectory, expectedArtifactFiles.contents)
    const packageExportArguments = [
      'scripts/check-package-exports.mjs',
      '--package',
      releasePackageId,
      '--tarball',
      tarballPath,
      '--manifest',
      contentsPath,
    ]
    if (releasePackageId === 'nuxt') {
      packageExportArguments.push(
        '--vue-tarball',
        getPackageArtifactCoordinates('vue', { repositoryRoot: repoRoot }).paths.tarball,
      )
    }
    run('node', packageExportArguments)
    const contents = JSON.parse(readFileSync(contentsPath, 'utf8'))
    if (contents.version !== version) {
      throw new Error(
        `Packed identity ${String(packResult[0].name)}@${String(contents.version)} does not match ${packageJson.name}@${version}.`,
      )
    }

    const sbomPath = join(stagingDirectory, expectedArtifactFiles.sbom)
    generateCandidateSbom(tarballPath, sbomPath)

    const tarballIntegrity = integrity(tarballPath)
    if (packResult[0].integrity && packResult[0].integrity !== tarballIntegrity) {
      throw new Error('npm pack integrity does not match the independently computed tarball SRI.')
    }
    const evidence = {
      schemaVersion: packageArtifactEvidenceSchemaVersion,
      packageId: artifactCoordinates.packageId,
      packageName: artifactCoordinates.packageName,
      packageDirectory: artifactCoordinates.packageDirectory,
      version,
      profiles: artifactCoordinates.profiles,
      sourceCommit,
      packageManager: workspacePackageManager,
      node: process.version,
      npm: output('npm', ['--version']),
      pnpm: output('pnpm', ['--version']),
      sourceTree: 'clean',
      runtimeFingerprint,
      tarball: {
        ...fileEvidence(tarballPath),
        integrity: tarballIntegrity,
      },
      contents: fileEvidence(contentsPath),
      sbom: fileEvidence(sbomPath),
    }
    const evidencePath = join(stagingDirectory, expectedArtifactFiles.evidence)
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)

    ensureCleanWorkingTree()
    if (output('git', ['rev-parse', 'HEAD']) !== sourceCommit) {
      throw new Error('Release source commit changed while creating the artifact.')
    }
    assertPackageArtifactWriteTarget(releasePackageId)
    renameSync(stagingDirectory, artifactCoordinates.directory)
    committed = true

    const committedTarballPath = artifactCoordinates.paths.tarball
    const committedEvidencePath = artifactCoordinates.paths.evidence
    console.log(`\nImmutable release candidate: ${committedTarballPath}`)
    console.log(`Artifact evidence: ${committedEvidencePath}`)
    console.log(`SHA-256: ${evidence.tarball.sha256}`)
    console.log(`SRI: ${evidence.tarball.integrity}`)
    return { evidencePath: committedEvidencePath, tarballPath: committedTarballPath }
  } finally {
    if (!committed) rmSync(stagingDirectory, { force: true, recursive: true })
  }
}

function main() {
  if (command === 'verify') {
    verifyArtifact(verifyPath)
    return
  }
  ensureCleanWorkingTree()
  requirePreparedChangelog()
  const artifact = createArtifact()
  if (command === 'prepare') {
    run('node', [
      'scripts/verify-release.mjs',
      '--package',
      releasePackageId,
      '--artifact-manifest',
      artifact.evidencePath,
    ])
  }
  ensureCleanWorkingTree()
  console.log(
    `\nPrepared ${packageJson.name}@${version}. Publication is permitted only from the protected trusted-publishing workflow using this exact tarball.`,
  )
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
