#!/usr/bin/env node
/**
 * Packed-entry package contract gate.
 *
 * A coarse source hygiene scan cannot prove packed entry purity or that a
 * published tarball resolves for a real consumer. This script:
 *
 *   1. runs the selected profile's fast source-level hygiene scan for
 *      alias/absolute-path/undeclared-dependency leaks — no build required;
 *   2. requires `dist/` to already exist (built by `nuxt-module-build build`,
 *      as `prepack` does) and fails loudly, not vacuously, if it is missing;
 *   3. in the default mode, packs the current tree once and extracts that
 *      exact tarball; release verification instead supplies its already-packed
 *      artifact with `--tarball`, while `prepack` uses `--dist-only` to avoid
 *      recursively packing during the build lifecycle;
 *   4. scans the extracted tarball for invalid path classes, generated debris,
 *      source-machine absolute paths, and undeclared dependencies;
 *   5. for each table entry, uses the installed TypeScript compiler to prove
 *      its dist files export the reviewed names and its transitive runtime and
 *      declaration graphs use exactly the reviewed external specifiers;
 *   6. for each entry with a packed consumer fixture, runs an isolated
 *      install of that fixture against the freshly packed tarball and proves
 *      runtime resolution (`node`) and type resolution (`tsc`).
 *
 * Public paths and export names come exclusively from the descriptor-selected
 * package-entry manifest. Checker modules add profile-specific dependency
 * surfaces and packed consumer probes without redefining that contract.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalNpmTarballFilename } from './package-artifact-coordinates.mjs'
import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'
import { checkEntryExportShapes } from './package-check/declarations.mjs'
import { getPackageCheckerProfile } from './package-check/entry-rules.mjs'
import {
  checkPackageJsonManifestConsistency,
  collectExportTargets,
} from './package-check/manifest-consistency.mjs'
import { assertProductionManifestContract } from './package-check/production-manifest-contract.mjs'
import { checkEntryPurities } from './package-check/purity.mjs'
import {
  buildContentManifest,
  packAndExtract,
  requireDistBuilt,
  scanExtractedTarball,
} from './package-check/tarball.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const cliArgs = process.argv.slice(2)

function failCli(message) {
  console.error(message)
  process.exit(1)
}

const parsedOptions = new Map()
let distOnly = false

function setOption(name, value) {
  if (parsedOptions.has(name)) failCli(`${name} may be supplied only once.`)
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
    failCli(`${name} requires a value.`)
  }
  parsedOptions.set(name, value)
}

for (let index = 0; index < cliArgs.length; index += 1) {
  const argument = cliArgs[index]
  if (argument === '--dist-only') {
    if (distOnly) failCli('--dist-only may be supplied only once.')
    distOnly = true
    continue
  }
  if (
    argument === '--package' ||
    argument === '--tarball' ||
    argument === '--manifest' ||
    argument === '--vue-tarball'
  ) {
    setOption(argument, cliArgs[index + 1])
    index += 1
    continue
  }
  const inlineMatch = /^(--(?:package|tarball|manifest|vue-tarball))=(.*)$/u.exec(argument)
  if (inlineMatch) {
    setOption(inlineMatch[1], inlineMatch[2])
    continue
  }
  failCli(`Unknown package-check option: ${argument}`)
}

const packageId = parsedOptions.get('--package')
if (!packageId) failCli('--package requires a reviewed package identifier.')
const suppliedTarball = parsedOptions.get('--tarball')
const manifestOutput = parsedOptions.get('--manifest')
const suppliedVueTarball = parsedOptions.get('--vue-tarball')
if (distOnly && (suppliedTarball || manifestOutput || suppliedVueTarball)) {
  failCli('--dist-only cannot be combined with --tarball, --manifest, or --vue-tarball.')
}
if (packageId === 'nuxt' && suppliedTarball && !suppliedVueTarball) {
  failCli('--vue-tarball is required when verifying a supplied Nuxt tarball.')
}
if (suppliedVueTarball && packageId !== 'nuxt') {
  failCli('--vue-tarball is valid only for the reviewed Nuxt package.')
}

let checkerProfile
try {
  checkerProfile = getPackageCheckerProfile(packageId)
} catch (error) {
  failCli(error instanceof Error ? error.message : String(error))
}
const packageRoot = resolve(repoRoot, checkerProfile.packageDirectory)
const p = (...segments) => resolve(packageRoot, ...segments)
const packageJson = JSON.parse(readFileSync(p('package.json'), 'utf8'))
const entries = checkerProfile.entries

const temporaryCompanionScratchDirs = []

function prepareCompanionTarballs() {
  if (packageId !== 'nuxt' || distOnly) return []

  const descriptor = getPackageCertificationDescriptor('vue')
  let tarballPath
  let extracted
  let removeAfterInspection = true

  if (suppliedVueTarball) {
    tarballPath = resolve(repoRoot, suppliedVueTarball)
    let stats
    try {
      stats = lstatSync(tarballPath)
    } catch {
      failCli(`Supplied Vue companion tarball does not exist: ${tarballPath}`)
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      failCli('Supplied Vue companion must be a regular, non-symlink tarball.')
    }
    extracted = packAndExtract('vue', tarballPath)
  } else {
    requireDistBuilt('vue')
    console.log('Packing the reviewed workspace Vue package as the local companion…')
    extracted = packAndExtract('vue')
    tarballPath = extracted.tarballPath
    temporaryCompanionScratchDirs.push(extracted.scratchDir)
    removeAfterInspection = false
  }

  try {
    const manifest = JSON.parse(readFileSync(resolve(extracted.packageDir, 'package.json'), 'utf8'))
    if (manifest.name !== descriptor.packageName) {
      failCli('Supplied Vue companion has an unexpected packed package name.')
    }
    const expectedFilename = canonicalNpmTarballFilename(descriptor.packageName, manifest.version)
    if (basename(tarballPath) !== expectedFilename) {
      failCli(`Supplied Vue companion must use canonical filename ${expectedFilename}.`)
    }
    if (packageJson.dependencies?.[descriptor.packageName] !== manifest.version) {
      failCli(
        `${checkerProfile.packageName} must depend on exact ${descriptor.packageName}@${manifest.version}.`,
      )
    }
    return [
      Object.freeze({
        filename: expectedFilename,
        packageName: descriptor.packageName,
        tarballPath,
        version: manifest.version,
      }),
    ]
  } finally {
    if (removeAfterInspection) {
      rmSync(extracted.scratchDir, { recursive: true, force: true })
    }
  }
}

let companionTarballs = []

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

// ---------------------------------------------------------------------------
// 1. Fast source-level scan (no build needed)
// ---------------------------------------------------------------------------

const sourceDeclaredPackages = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
])
const allowedVirtualImports = new Set(checkerProfile.sourceScan.allowedVirtualImports)
// `#convex/*` is the module's generated-template namespace, resolved through
// `nuxt.options.alias` the same way
// `#app`/`#build`/`#components` are — never a real npm package.
const allowedVirtualPrefixes = checkerProfile.sourceScan.allowedVirtualPrefixes
const allowedFrameworkPackages = new Set(checkerProfile.sourceScan.allowedFrameworkPackages)
const checkedExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.vue'])
// Build output is inspected from the packed artifact below. Scanning Nuxt's
// generated browser chunks as authored source misclassifies strings and
// bundler loaders as package imports.
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist'])

function collectFiles(target) {
  if (!existsSync(target)) return []
  const stat = statSync(target)
  if (stat.isFile()) return checkedExtensions.has(extname(target)) ? [target] : []
  if (!stat.isDirectory()) return []
  const files = []
  for (const entry of readdirSync(target)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue
    files.push(...collectFiles(join(target, entry)))
  }
  return files
}

function rootPackageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope && name ? `${scope}/${name}` : specifier
  }
  return specifier.split('/')[0] ?? specifier
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function isAllowedVirtualSpecifier(specifier) {
  return (
    allowedVirtualImports.has(specifier) ||
    allowedVirtualPrefixes.some((prefix) => specifier.startsWith(prefix))
  )
}

function isIgnoredLine(line) {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('*') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('<!--') ||
    trimmed.startsWith('|')
  )
}

function readQuotedSpecifier(line, startIndex) {
  const quoteIndex = line.slice(startIndex).search(/['"]/)
  if (quoteIndex < 0) return null
  const absoluteQuoteIndex = startIndex + quoteIndex
  const quote = line[absoluteQuoteIndex]
  const endIndex = line.indexOf(quote, absoluteQuoteIndex + 1)
  if (endIndex < 0) return null
  return line.slice(absoluteQuoteIndex + 1, endIndex)
}

function extractSpecifiers(line) {
  const specifiers = []
  const trimmed = line.trimStart()

  if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
    const fromIndex = line.lastIndexOf(' from ')
    if (fromIndex >= 0) {
      const specifier = readQuotedSpecifier(line, fromIndex + ' from '.length)
      if (specifier) specifiers.push(specifier)
    } else if (trimmed.startsWith('import ')) {
      const importIndex = line.indexOf('import')
      const specifier = readQuotedSpecifier(line, importIndex + 'import'.length)
      if (specifier) specifiers.push(specifier)
    }
  }

  let dynamicIndex = line.indexOf('import(')
  while (dynamicIndex >= 0) {
    const specifier = readQuotedSpecifier(line, dynamicIndex + 'import('.length)
    if (specifier) specifiers.push(specifier)
    dynamicIndex = line.indexOf('import(', dynamicIndex + 1)
  }

  return specifiers
}

function validateSourceSpecifier(file, specifier, lineNumber, failures) {
  const location = `${relative(packageRoot, file)}:${lineNumber}`

  if (
    specifier.startsWith('$lib') ||
    specifier.startsWith('$app') ||
    specifier.startsWith('~/') ||
    specifier.startsWith('~~/')
  ) {
    failures.push(`${location} imports app-specific alias "${specifier}"`)
  }
  if (
    specifier.includes('/Users/') ||
    specifier.startsWith('/Users/') ||
    specifier.includes('/home/')
  ) {
    failures.push(`${location} imports local machine path "${specifier}"`)
  }
  if (/\b(?:playground|demo|starters)\b/.test(specifier)) {
    failures.push(`${location} imports non-package workspace path "${specifier}"`)
  }

  if (isRelativeSpecifier(specifier)) {
    const resolved = resolve(dirname(file), specifier)
    const relativeToRoot = relative(packageRoot, resolved)
    if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
      failures.push(`${location} imports outside package root via "${specifier}"`)
    }
    return
  }

  if (nodeBuiltins.has(specifier) || isAllowedVirtualSpecifier(specifier)) return
  if (specifier.startsWith('node:')) {
    failures.push(`${location} imports unknown Node builtin "${specifier}"`)
    return
  }
  const packageName = rootPackageName(specifier)
  if (allowedFrameworkPackages.has(packageName)) return
  if (!sourceDeclaredPackages.has(packageName)) {
    failures.push(`${location} imports undeclared package "${packageName}" via "${specifier}"`)
  }
}

function runSourceScan() {
  const failures = []
  const sourceRoots = checkerProfile.sourceRoots.map((sourceRoot) => p(sourceRoot))
  const files = sourceRoots.flatMap(collectFiles)

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const lines = source.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (isIgnoredLine(line)) return
      for (const specifier of extractSpecifiers(line)) {
        validateSourceSpecifier(file, specifier, index + 1, failures)
      }
    })
  }

  // package.json exports must at least point at files that exist in source form
  // or will exist once built; a stale export table entry is a real defect.
  for (const [subpath, exportValue] of Object.entries(packageJson.exports ?? {})) {
    for (const target of collectExportTargets(exportValue)) {
      if (!target.startsWith('./')) continue
      // Built files do not exist pre-build; only flag paths that are neither a
      // dist path nor resolvable at all (i.e. clearly a typo).
      if (target.startsWith('./dist/')) continue
      if (!existsSync(resolve(packageRoot, target))) {
        failures.push(`package.json exports["${subpath}"] points to missing file "${target}"`)
      }
    }
  }

  return { failures, filesScanned: files.length }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const failures = []

  const sourceScan = runSourceScan()
  failures.push(...sourceScan.failures)
  failures.push(
    ...checkPackageJsonManifestConsistency({
      manifest: packageJson,
      entries,
      expectedBins: checkerProfile.bins,
      artifactRoot: packageRoot,
      checkBinFiles: !suppliedTarball,
      requireLegacyRootFields: checkerProfile.manifestPolicy.requireLegacyRootFields,
    }),
  )

  // A release verification job receives the immutable tarball rather than a
  // rebuilt root dist. Entry declarations and purity are checked inside the
  // extracted supplied package below.
  if (!suppliedTarball) requireDistBuilt(packageId)

  if (distOnly) {
    checkEntryExportShapes(entries, failures, packageRoot)
    checkEntryPurities(entries, failures, packageRoot)
  } else {
    companionTarballs = prepareCompanionTarballs()
    console.log(
      suppliedTarball
        ? `Extracting the supplied tarball for packed-probe evidence: ${suppliedTarball}`
        : 'Packing and extracting the current tree for packed-probe evidence…',
    )
    const { scratchDir, tarballPath, packageDir, archiveEntries } = packAndExtract(
      packageId,
      suppliedTarball,
    )
    try {
      const manifest = buildContentManifest(packageDir, archiveEntries)
      const packedPackageJson = JSON.parse(
        readFileSync(resolve(packageDir, 'package.json'), 'utf8'),
      )
      try {
        assertProductionManifestContract(packageId, packedPackageJson, packageJson)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
      scanExtractedTarball(packageId, packageDir, failures, manifest)
      failures.push(
        ...checkPackageJsonManifestConsistency({
          manifest: packedPackageJson,
          entries,
          expectedBins: checkerProfile.bins,
          artifactRoot: packageDir,
          requireLegacyRootFields: checkerProfile.manifestPolicy.requireLegacyRootFields,
        }),
      )

      checkEntryExportShapes(entries, failures, packageDir)
      checkEntryPurities(entries, failures, packageDir)

      if (failures.length === 0) {
        const ctx = {
          packageName: checkerProfile.packageName,
          repositoryRoot: repoRoot,
          packageManifest: packageJson,
          tarballPath,
          companionTarballs,
          failures,
        }
        for (const entry of entries) {
          if (!entry.packedProbe) continue
          console.log(`Running packed probe for "${entry.subpath}"…`)
          entry.packedProbe(ctx)
        }
      }

      if (manifestOutput && failures.length === 0) {
        const outputPath = resolve(repoRoot, manifestOutput)
        mkdirSync(dirname(outputPath), { recursive: true })
        writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
        console.log(`Content manifest: ${outputPath}`)
      }
    } finally {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  }

  if (failures.length > 0) {
    console.error(`\nPackage export validation failed with ${failures.length} issue(s):`)
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exitCode = 1
    return
  }

  console.log(
    `✓ ${checkerProfile.packageId} ${distOnly ? 'dist-entry' : 'packed-entry'} gate passed (${sourceScan.filesScanned} source file(s) scanned, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} deep-checked).`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } finally {
    for (const scratchDir of temporaryCompanionScratchDirs) {
      rmSync(scratchDir, { recursive: true, force: true })
    }
  }
}
