#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const p = (...segments) => resolve(repoRoot, ...segments)
const ledgerPath = p('security/upstream-convex-better-auth.json')
const apacheLicensePath = p('LICENSES/Apache-2.0.txt')
const noticePath = p('THIRD_PARTY_NOTICES.md')
const expectedApacheLicenseSha256 =
  '4458503dd48e88c4e0b945fb252a08b93c40ec757309b8ffa7c594dfa1e35104'
const classifications = new Set(['copied', 'adapted', 'rewritten', 'regenerated', 'omitted'])
const requiredPackedFiles = [
  'LICENSE',
  'LICENSES/Apache-2.0.txt',
  'THIRD_PARTY_NOTICES.md',
  'security/upstream-convex-better-auth.json',
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function collectSourceFiles(directory) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectSourceFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function matchesAuthorizedSeam(sourcePath, seam) {
  if (seam.endsWith('/**')) {
    const prefix = seam.slice(0, -3)
    return sourcePath === prefix || sourcePath.startsWith(`${prefix}/`)
  }
  return sourcePath === seam
}

function collectAuthorizedTargets(seams) {
  const targets = new Set()
  for (const seam of seams) {
    if (seam.endsWith('/**')) {
      const directory = p(seam.slice(0, -3))
      for (const target of collectSourceFiles(directory)) targets.add(target)
      continue
    }
    const target = p(seam)
    if (existsSync(target) && statSync(target).isFile()) targets.add(target)
  }
  return [...targets]
}

function hasProminentModificationNotice(source, sourceCommit) {
  const header = source.slice(0, 2_048)
  return (
    /\b(?:adapted|derived) from get-convex\/better-auth\b/iu.test(header) &&
    header.includes(sourceCommit) &&
    header.includes('Apache-2.0')
  )
}

function validateSourceContract(failures) {
  for (const path of [p('LICENSE'), apacheLicensePath, noticePath, ledgerPath]) {
    if (!existsSync(path))
      failures.push(`required provenance file is missing: ${relative(repoRoot, path)}`)
  }
  if (failures.length > 0) return null

  if (sha256(readFileSync(apacheLicensePath)) !== expectedApacheLicenseSha256) {
    failures.push('LICENSES/Apache-2.0.txt is not the canonical complete Apache-2.0 text')
  }

  const ledger = readJson(ledgerPath)
  const upstream = ledger.upstream ?? {}
  const sourceSeams = Array.isArray(ledger.authorizedSourceSeams)
    ? ledger.authorizedSourceSeams
    : []
  const targetSeams = Array.isArray(ledger.authorizedTargetSeams)
    ? ledger.authorizedTargetSeams
    : []
  if (ledger.schemaVersion !== 1) failures.push('provenance ledger schemaVersion must be 1')
  if (upstream.repository !== 'https://github.com/get-convex/better-auth') {
    failures.push('provenance ledger has an unexpected upstream repository')
  }
  if (!/^[0-9a-f]{40}$/u.test(upstream.commit ?? '')) {
    failures.push('provenance ledger upstream commit must be a full lowercase Git SHA')
  }
  if (typeof upstream.tag !== 'string' || upstream.tag.length === 0) {
    failures.push('provenance ledger upstream tag is missing')
  }
  if (upstream.license !== 'Apache-2.0') {
    failures.push('provenance ledger upstream license must be Apache-2.0')
  }
  if (upstream.noticeFilePresent !== false) {
    failures.push('the recorded upstream baseline unexpectedly declares a NOTICE file')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(ledger.importedAt ?? '')) {
    failures.push('provenance ledger importedAt must be an ISO date')
  }
  if (sourceSeams.length === 0) {
    failures.push('provenance ledger must enumerate authorized source seams')
  }
  if (targetSeams.length === 0) {
    failures.push('provenance ledger must enumerate authorized target seams')
  }
  if (!Array.isArray(ledger.omittedAreas) || ledger.omittedAreas.length === 0) {
    failures.push('provenance ledger must enumerate intentionally omitted areas')
  }
  if (!Array.isArray(ledger.records)) failures.push('provenance ledger records must be an array')

  const notice = readFileSync(noticePath, 'utf8')
  for (const expected of [
    upstream.repository,
    upstream.commit,
    upstream.tag,
    'LICENSES/Apache-2.0.txt',
    'contains no `NOTICE`',
  ]) {
    if (typeof expected === 'string' && !notice.includes(expected)) {
      failures.push(`THIRD_PARTY_NOTICES.md is missing upstream fact: ${expected}`)
    }
  }

  const packageJson = readJson(p('package.json'))
  const packedAllowlist = new Set(packageJson.files ?? [])
  for (const required of [
    'dist',
    'LICENSES',
    'THIRD_PARTY_NOTICES.md',
    'security/upstream-convex-better-auth.json',
  ]) {
    if (!packedAllowlist.has(required)) {
      failures.push(`package.json files must include ${required}`)
    }
  }

  if (!Array.isArray(ledger.records)) return ledger

  const targetRecords = new Map()
  const mappingKeys = new Set()
  for (const [index, record] of ledger.records.entries()) {
    const label = `provenance record ${index + 1}`
    if (!classifications.has(record.classification)) {
      failures.push(`${label} has invalid classification ${record.classification}`)
    }
    if (typeof record.sourcePath !== 'string' || record.sourcePath.length === 0) {
      failures.push(`${label} is missing sourcePath`)
    } else if (!sourceSeams.some((seam) => matchesAuthorizedSeam(record.sourcePath, seam))) {
      failures.push(`${label} expands the authorized source surface: ${record.sourcePath}`)
    }
    if (record.sourceCommit !== upstream.commit) {
      failures.push(`${label} sourceCommit does not match the canonical upstream commit`)
    }
    if (!/^[0-9a-f]{64}$/u.test(record.sourceSha256 ?? '')) {
      failures.push(`${label} is missing a full lowercase sourceSha256`)
    }
    if (typeof record.modificationSummary !== 'string' || record.modificationSummary.length === 0) {
      failures.push(`${label} is missing modificationSummary`)
    }
    if (
      typeof record.latestReviewedUpstreamPatch !== 'string' ||
      record.latestReviewedUpstreamPatch.length === 0
    ) {
      failures.push(`${label} is missing latestReviewedUpstreamPatch`)
    }

    const mappingKey = `${record.sourcePath ?? '<missing>'}\0${record.targetPath ?? '<omitted>'}`
    if (mappingKeys.has(mappingKey)) failures.push(`${label} duplicates an existing source mapping`)
    mappingKeys.add(mappingKey)

    if (record.classification === 'omitted') {
      if (record.targetPath !== null || record.targetSha256 !== null) {
        failures.push(`${label} is omitted and must have null targetPath and targetSha256`)
      }
      continue
    }

    const targetPath = typeof record.targetPath === 'string' ? p(record.targetPath) : repoRoot
    const canonicalTargetPath = relative(repoRoot, targetPath).split('\\').join('/')
    if (
      typeof record.targetPath !== 'string' ||
      !targetPath.startsWith(`${repoRoot}${sep}`) ||
      canonicalTargetPath !== record.targetPath ||
      !targetSeams.some((seam) => matchesAuthorizedSeam(record.targetPath, seam))
    ) {
      failures.push(`${label} targetPath must be inside an authorized target seam`)
      continue
    }
    if (!targetRecords.has(record.targetPath)) targetRecords.set(record.targetPath, record)

    if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
      failures.push(`${label} target is missing: ${record.targetPath}`)
      continue
    }
    if (!/^[0-9a-f]{64}$/u.test(record.targetSha256 ?? '')) {
      failures.push(`${label} is missing a full lowercase targetSha256`)
    } else if (sha256(readFileSync(targetPath)) !== record.targetSha256) {
      failures.push(`${label} target changed without a provenance ledger update`)
    }
    if (record.classification === 'copied' && record.sourceSha256 !== record.targetSha256) {
      failures.push(`${label} is classified as copied but its source and target hashes differ`)
    }
    if (typeof record.noticeRequired !== 'boolean') {
      failures.push(`${label} must declare noticeRequired`)
    }
    if (record.classification === 'adapted' && record.noticeRequired !== true) {
      failures.push(`${label} must require a prominent modification notice`)
    }
    if (
      record.noticeRequired &&
      !hasProminentModificationNotice(readFileSync(targetPath, 'utf8'), record.sourceCommit)
    ) {
      failures.push(`${label} target is missing the required modification notice`)
    }
  }

  for (const targetPath of collectAuthorizedTargets(targetSeams)) {
    const target = relative(repoRoot, targetPath).split('\\').join('/')
    if (!targetRecords.has(target)) {
      failures.push(`Authorized derived target has no provenance record: ${target}`)
    }
  }

  return ledger
}

function parseArguments() {
  const args = process.argv.slice(2)
  let tarball
  let sourceOnly = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--source-only') {
      sourceOnly = true
      continue
    }
    if (argument === '--tarball') {
      tarball = args[index + 1]
      if (!tarball || tarball.startsWith('--')) throw new Error('--tarball requires a path')
      index += 1
      continue
    }
    throw new Error(`Unknown provenance-check option: ${argument}`)
  }
  if (sourceOnly && tarball) throw new Error('--source-only cannot be combined with --tarball')
  return { sourceOnly, tarball: tarball ? resolve(repoRoot, tarball) : undefined }
}

function packCurrentTree(scratchDir) {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--loglevel=error', '--pack-destination', scratchDir],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(scratchDir, '.npm-cache') },
    },
  )
  const [result] = JSON.parse(output)
  if (!result?.filename) throw new Error('npm pack returned no artifact filename')
  return join(scratchDir, result.filename)
}

function validatePackedProvenance(tarballPath, failures) {
  if (!existsSync(tarballPath)) {
    failures.push(`provenance tarball does not exist: ${tarballPath}`)
    return
  }
  const entries = new Set(
    execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
      .split(/\r?\n/u)
      .filter(Boolean),
  )

  for (const file of requiredPackedFiles) {
    const packedPath = `package/${file}`
    if (!entries.has(packedPath)) {
      failures.push(`packed artifact is missing ${file}`)
      continue
    }
    const packed = execFileSync('tar', ['-xOf', tarballPath, packedPath])
    if (!packed.equals(readFileSync(p(file)))) {
      failures.push(`packed artifact ${file} differs from the reviewed source file`)
    }
  }
}

function main() {
  let options
  try {
    options = parseArguments()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const failures = []
  const ledger = validateSourceContract(failures)
  let scratchDir

  if (!options.sourceOnly) {
    try {
      let tarballPath = options.tarball
      if (!tarballPath) {
        scratchDir = mkdtempSync(join(tmpdir(), 'bcn-auth-provenance-'))
        tarballPath = packCurrentTree(scratchDir)
      }
      validatePackedProvenance(tarballPath, failures)
    } catch (error) {
      failures.push(
        `could not verify packed provenance: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
    }
  }

  if (failures.length > 0) {
    console.error(`Auth provenance check failed with ${failures.length} issue(s):`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  console.log(
    `Auth provenance check passed (${ledger?.records?.length ?? 0} ledger record(s), ${options.sourceOnly ? 'source only' : 'source and packed artifact'}).`,
  )
}

export {
  collectAuthorizedTargets,
  collectSourceFiles,
  hasProminentModificationNotice,
  matchesAuthorizedSeam,
  validatePackedProvenance,
  validateSourceContract,
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) main()
