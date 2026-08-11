import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export function collectExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap((next) => collectExportTargets(next))
}

function collectBinEntries(value, manifest) {
  if (typeof value === 'string') return [[manifest.name, value]]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value)
}

function isCoveredByPackageFiles(path, declaredFiles) {
  return declaredFiles.some(
    (entry) => path === entry || path.startsWith(`${entry.replace(/\/$/u, '')}/`),
  )
}

function staysInside(root, target) {
  const pathFromRoot = relative(root, target)
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

/**
 * Prove that one source or extracted package manifest exposes exactly the
 * descriptor-selected entry contract. The caller supplies the artifact root
 * only to verify executable bin targets; it never selects policy.
 */
export function checkPackageJsonManifestConsistency({
  manifest,
  entries,
  expectedBins,
  artifactRoot,
  checkBinFiles = true,
  requireLegacyRootFields = true,
}) {
  const failures = []
  const exportsMap = manifest.exports ?? {}
  const declaredFiles = manifest.files ?? []

  if (manifest.type !== 'module') {
    failures.push('package.json type must be "module" for the reviewed ESM entry contract')
  }

  const rootEntry = entries.find((entry) => entry.subpath === '.')
  if (!rootEntry || rootEntry.kind !== 'runtime') {
    failures.push('package entry contract must contain one runtime root entry')
  } else if (requireLegacyRootFields && manifest.main !== `./${rootEntry.distJs}`) {
    failures.push(`package.json main must be "./${rootEntry.distJs}" (manifest source of truth)`)
  }

  const contractSubpaths = new Set(entries.map((entry) => entry.subpath))
  for (const entry of entries) {
    const packageEntry = exportsMap[entry.subpath]
    if (!packageEntry || typeof packageEntry !== 'object' || Array.isArray(packageEntry)) {
      failures.push(`package.json exports is missing manifest entry "${entry.subpath}"`)
      continue
    }
    if (entry.kind === 'runtime') {
      if (packageEntry.import !== `./${entry.distJs}`) {
        failures.push(
          `package.json exports["${entry.subpath}"].import must be "./${entry.distJs}" (manifest source of truth)`,
        )
      }
    } else if (Object.hasOwn(packageEntry, 'import')) {
      failures.push(
        `package.json exports["${entry.subpath}"] is types-only and must not declare an import target`,
      )
    }
    if (packageEntry.types !== `./${entry.distDts}`) {
      failures.push(
        `package.json exports["${entry.subpath}"].types must be "./${entry.distDts}" (manifest source of truth)`,
      )
    }
    const expectedConditions = entry.kind === 'runtime' ? ['types', 'import'] : ['types']
    const actualConditions = Object.keys(packageEntry)
    if (
      actualConditions.length !== expectedConditions.length ||
      actualConditions.some((condition, index) => condition !== expectedConditions[index])
    ) {
      failures.push(
        `package.json exports["${entry.subpath}"] conditions must be exactly ${JSON.stringify(expectedConditions)} in that order`,
      )
    }
    const allowedConditions = new Set(expectedConditions)
    for (const condition of actualConditions) {
      if (!allowedConditions.has(condition)) {
        failures.push(
          `package.json exports["${entry.subpath}"] has undeclared condition "${condition}"`,
        )
      }
    }
  }
  for (const subpath of Object.keys(exportsMap)) {
    if (!contractSubpaths.has(subpath)) {
      failures.push(`package.json exports contains undeclared manifest entry "${subpath}"`)
    }
  }

  const filesCoversDist = declaredFiles.includes('dist')
  for (const [subpath, exportValue] of Object.entries(exportsMap)) {
    for (const target of collectExportTargets(exportValue)) {
      if (!target.startsWith('./')) continue
      const stripped = target.slice(2)
      const coveredByDist = filesCoversDist && stripped.startsWith('dist/')
      const coveredExplicitly = isCoveredByPackageFiles(stripped, declaredFiles)
      if (!coveredByDist && !coveredExplicitly) {
        failures.push(
          `package.json exports["${subpath}"] target "${target}" is not covered by "files": ${JSON.stringify(declaredFiles)}`,
        )
      }
    }
  }

  const binEntries = collectBinEntries(manifest.bin, manifest)
  if (manifest.bin !== undefined && binEntries.length === 0) {
    failures.push('package.json bin must be a string or non-empty command map')
  }
  for (const [command, expectedTarget] of Object.entries(expectedBins)) {
    if (!Object.hasOwn(manifest.bin ?? {}, command)) {
      failures.push(`package.json bin is missing reviewed command "${command}"`)
    } else if (manifest.bin[command] !== expectedTarget) {
      failures.push(
        `package.json bin["${command}"] must be "${expectedTarget}" (manifest source of truth)`,
      )
    }
  }
  for (const [command] of binEntries) {
    if (!Object.hasOwn(expectedBins, command)) {
      failures.push(`package.json bin contains undeclared command "${command}"`)
    }
  }
  for (const [command, target] of binEntries) {
    if (typeof command !== 'string' || command.length === 0 || typeof target !== 'string') {
      failures.push('package.json bin entries must have non-empty command and target strings')
      continue
    }
    const targetPath = resolve(artifactRoot, target)
    if (!target.startsWith('./dist/') || !staysInside(artifactRoot, targetPath)) {
      failures.push(`package.json bin["${command}"] must point inside ./dist/: ${target}`)
      continue
    }
    const stripped = target.slice(2)
    if (!isCoveredByPackageFiles(stripped, declaredFiles)) {
      failures.push(`package.json bin["${command}"] target "${target}" is not covered by files`)
    }
    if (!checkBinFiles) continue
    if (!existsSync(targetPath)) {
      failures.push(`package.json bin["${command}"] target is missing: ${target}`)
    } else if (!readFileSync(targetPath, 'utf8').startsWith('#!/usr/bin/env node\n')) {
      failures.push(`package.json bin["${command}"] target must start with a Node shebang`)
    }
  }

  if (!requireLegacyRootFields) return failures

  const typesVersions = isPlainRecord(manifest.typesVersions) ? manifest.typesVersions : {}
  const selectors = Object.keys(typesVersions)
  if (selectors.length !== 1 || selectors[0] !== '*') {
    failures.push('package.json typesVersions must contain exactly the "*" selector')
  }
  const typesVersionsStar = isPlainRecord(typesVersions['*']) ? typesVersions['*'] : {}
  if (!isPlainRecord(typesVersions['*'])) {
    failures.push('package.json typesVersions["*"] must be an object')
  }

  const expectedTypeTargets = new Map(
    entries.map((entry) => [
      entry.subpath === '.' ? '.' : entry.subpath.slice(2),
      `./${entry.distDts}`,
    ]),
  )
  for (const [subpath, expectedTarget] of expectedTypeTargets) {
    if (!Object.hasOwn(typesVersionsStar, subpath)) {
      failures.push(`typesVersions["*"] is missing an entry for exports subpath "${subpath}"`)
      continue
    }
    const targets = typesVersionsStar[subpath]
    if (
      !Array.isArray(targets) ||
      targets.length !== 1 ||
      typeof targets[0] !== 'string' ||
      targets[0] !== expectedTarget
    ) {
      failures.push(
        `typesVersions["*"]["${subpath}"] must be exactly ["${expectedTarget}"] (manifest source of truth)`,
      )
    }
  }
  for (const key of Object.keys(typesVersionsStar)) {
    if (!expectedTypeTargets.has(key)) {
      failures.push(`typesVersions["*"]["${key}"] has no matching exports subpath`)
    }
  }

  return failures
}
