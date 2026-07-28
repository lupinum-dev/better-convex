// Packed-tarball absolute-path / undeclared-dependency scan (architecture invariant)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import * as tar from 'tar'

import { getPackageCertificationDescriptor } from '../package-certification-manifest.mjs'
import { checkArtifactDeclarationProgram, checkArtifactJavaScriptProgram } from './declarations.mjs'
import {
  inspectModuleFile,
  isKnownTypeScriptLibReference,
  resolveArtifactModuleEdge,
  resolveArtifactReferencePathEdge,
} from './purity.mjs'

const repoRoot = resolve(import.meta.dirname, '../..')
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

function rootPackageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function staysInside(root, target) {
  const pathFromRoot = relative(root, target)
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function isPortableArchiveSegment(segment) {
  if (segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')) return false
  const windowsBaseName = segment.split('.')[0]?.toLowerCase()
  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(windowsBaseName ?? '')
}

function walkDir(dir, extensions) {
  if (!existsSync(dir)) return []
  const stats = statSync(dir)
  if (stats.isFile()) return extensions.has(extname(dir)) ? [dir] : []

  return readdirSync(dir).flatMap((name) => walkDir(join(dir, name), extensions))
}

function checkNodeModuleSyntax(file, relativePath, failures) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch {
    failures.push(`packed ${relativePath} is not valid Node ESM syntax`)
  }
}

function isBuiltDevtoolsBrowserAsset(packageDir, file) {
  const relativePath = relative(packageDir, file)
  return relativePath.startsWith('dist/runtime/devtools/ui/dist/')
}

// ---------------------------------------------------------------------------

/** Host-provided runtime/declaration specifiers legitimately unresolved by
 * this package's own declared dependencies. The selected Nuxt host supplies
 * them; entry graphs separately enforce exact public dependency surfaces. */
const ABS_PATH_RE = /(\/Users\/|\/home\/|[A-Z]:\\\\Users)\S*/g
const ALIAS_RE = /(?:^|["'`(\s])(~~?\/[^"'`)\s]*|\$lib\/[^"'`)\s]*|\$app\/[^"'`)\s]*)/g
const packedArtifactProfiles = Object.freeze({
  'nuxt-runtime-artifact': Object.freeze({
    allowedPackageRootFiles: Object.freeze([
      'LICENSE',
      'LICENSES/Apache-2.0.txt',
      'README.md',
      'THIRD_PARTY_NOTICES.md',
      'package.json',
      'security/upstream-convex-better-auth.json',
    ]),
    requiredPackedFiles: Object.freeze(['dist/runtime/devtools/ui/dist/index.html']),
    requiredBuildFiles: Object.freeze([
      'dist/module.mjs',
      'dist/types.d.mts',
      'dist/runtime/devtools/ui/dist/index.html',
    ]),
    allowedHostPackages: Object.freeze(['@nuxt/schema', 'vue', 'vue-router', 'nitropack']),
    allowedVirtualSpecifiers: Object.freeze(['#app', '#imports', '#convex/auth-client']),
    archiveLimits: Object.freeze({
      maxEntries: 4_096,
      maxFileBytes: 16 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    }),
    buildHint: 'pnpm exec nuxt-module-build build',
  }),
  'vue-runtime-artifact': Object.freeze({
    allowedPackageRootFiles: Object.freeze(['LICENSE', 'package.json']),
    requiredPackedFiles: Object.freeze([
      'dist/index.mjs',
      'dist/index.d.mts',
      'dist/errors.mjs',
      'dist/errors.d.mts',
      'dist/embedded.mjs',
      'dist/embedded.d.mts',
    ]),
    requiredBuildFiles: Object.freeze([
      'dist/index.mjs',
      'dist/index.d.mts',
      'dist/errors.mjs',
      'dist/errors.d.mts',
      'dist/embedded.mjs',
      'dist/embedded.d.mts',
    ]),
    allowedHostPackages: Object.freeze([]),
    allowedVirtualSpecifiers: Object.freeze([]),
    archiveLimits: Object.freeze({
      maxEntries: 256,
      maxFileBytes: 2 * 1024 * 1024,
      maxTotalBytes: 8 * 1024 * 1024,
    }),
    buildHint: 'pnpm run build',
  }),
  'mcp-runtime-artifact': Object.freeze({
    allowedPackageRootFiles: Object.freeze(['LICENSE', 'package.json']),
    requiredPackedFiles: Object.freeze(['dist/index.mjs', 'dist/index.d.mts']),
    requiredBuildFiles: Object.freeze(['dist/index.mjs', 'dist/index.d.mts']),
    allowedHostPackages: Object.freeze([]),
    allowedVirtualSpecifiers: Object.freeze([]),
    archiveLimits: Object.freeze({
      maxEntries: 128,
      maxFileBytes: 2 * 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
    }),
    buildHint: 'pnpm run build',
  }),
})

function getPackedArtifactProfile(packageId) {
  const descriptor = getPackageCertificationDescriptor(packageId)
  const profileId = descriptor.profiles.packedFiles
  const profile = packedArtifactProfiles[profileId]
  if (!profile) {
    throw new Error(`Package ${descriptor.id} has no reviewed packed-artifact profile.`)
  }
  return {
    descriptor,
    packageRoot: resolve(repoRoot, descriptor.packageDirectory),
    profile,
  }
}

function createTarballHeaderValidator(packageId) {
  const { profile } = getPackedArtifactProfile(packageId)
  const portablePaths = new Set()
  let entryCount = 0
  let totalBytes = 0

  return {
    add(entry) {
      entryCount += 1
      if (entryCount > profile.archiveLimits.maxEntries) {
        throw new Error(
          `Packed artifact archive exceeds ${profile.archiveLimits.maxEntries} file entries`,
        )
      }
      if (!entry || typeof entry.path !== 'string' || entry.type !== 'File') {
        throw new Error(
          `Packed artifact archive contains unsupported ${String(entry?.type ?? 'entry')} at ${String(entry?.path ?? '<unknown>')}`,
        )
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new Error(`Packed artifact archive has invalid size at ${entry.path}`)
      }
      if (!Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777) {
        throw new Error(`Packed artifact archive has invalid mode at ${entry.path}`)
      }
      if (entry.size > profile.archiveLimits.maxFileBytes) {
        throw new Error(
          `Packed artifact archive file exceeds ${profile.archiveLimits.maxFileBytes} bytes: ${entry.path}`,
        )
      }
      totalBytes += entry.size
      if (!Number.isSafeInteger(totalBytes) || totalBytes > profile.archiveLimits.maxTotalBytes) {
        throw new Error(
          `Packed artifact archive exceeds ${profile.archiveLimits.maxTotalBytes} total bytes`,
        )
      }
      if (
        entry.path !== entry.path.normalize('NFC') ||
        entry.path.includes('\\') ||
        hasControlCharacter(entry.path)
      ) {
        throw new Error(`Packed artifact archive path is not canonical: ${entry.path}`)
      }
      const segments = entry.path.split('/')
      if (
        segments.length < 2 ||
        segments[0] !== 'package' ||
        segments.some(
          (segment) =>
            segment.length === 0 ||
            segment === '.' ||
            segment === '..' ||
            !isPortableArchiveSegment(segment) ||
            segment.toLowerCase() === 'node_modules' ||
            segment.toLowerCase() === '.pnpm',
        ) ||
        (segments.at(-1)?.toLowerCase() === 'package.json' && entry.path !== 'package/package.json')
      ) {
        throw new Error(`Packed artifact archive path must stay under package/: ${entry.path}`)
      }
      const portablePath = entry.path.toLowerCase()
      if (portablePaths.has(portablePath)) {
        throw new Error(`Packed artifact archive contains a duplicate portable path: ${entry.path}`)
      }
      portablePaths.add(portablePath)
    },
    assertNonEmpty() {
      if (entryCount === 0) throw new Error('Packed artifact archive must contain files')
    },
  }
}

export function validateTarballEntryHeaders(packageId, entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Packed artifact archive must contain files')
  }
  const validator = createTarballHeaderValidator(packageId)
  for (const entry of entries) validator.add(entry)
  validator.assertNonEmpty()
  return entries
}

export function inspectTarballArchive(packageId, tarballPath) {
  const entries = []
  const validator = createTarballHeaderValidator(packageId)
  tar.t({
    file: tarballPath,
    onReadEntry(entry) {
      const header = { path: entry.path, size: entry.size, mode: entry.mode, type: entry.type }
      validator.add(header)
      entries.push(header)
      entry.resume()
    },
    strict: true,
    sync: true,
  })
  validator.assertNonEmpty()
  return entries
}

export function buildDirectoryContentIdentity(packageDir) {
  const files = []

  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const absolutePath = join(dir, name)
      const stats = lstatSync(absolutePath)
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Packed artifact contains a symbolic link: ${relative(packageDir, absolutePath)}`,
        )
      }
      if (stats.isDirectory()) {
        walk(absolutePath)
        continue
      }
      files.push({
        path: relative(packageDir, absolutePath).split('\\').join('/'),
        size: stats.size,
        sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
      })
    }
  }

  walk(packageDir)
  const packedPackageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  // This is release-content evidence, so it must describe only reproducible
  // package inputs. Recording wall-clock time would make equal builds differ.
  return { version: packedPackageJson.version, files }
}

export function buildContentManifest(packageDir, archiveEntries) {
  if (!Array.isArray(archiveEntries) || archiveEntries.length === 0) {
    throw new TypeError('Content manifests require validated tarball entry headers.')
  }
  const identity = buildDirectoryContentIdentity(packageDir)
  const extractedFiles = new Map(identity.files.map((file) => [file.path, file]))
  const files = archiveEntries
    .map((entry) => {
      const path = entry.path.slice('package/'.length)
      const extracted = extractedFiles.get(path)
      if (!extracted || extracted.size !== entry.size) {
        throw new Error(`Extracted package does not match archive header: ${entry.path}`)
      }
      extractedFiles.delete(path)
      return {
        path,
        mode: (entry.mode & 0o777).toString(8).padStart(3, '0'),
        size: entry.size,
        sha256: extracted.sha256,
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  if (extractedFiles.size > 0) {
    throw new Error(
      `Extracted package contains files absent from the archive: ${[...extractedFiles.keys()].join(', ')}`,
    )
  }
  return { version: identity.version, files }
}

export function checkPackedPathClasses(packageId, manifest, failures) {
  const { profile } = getPackedArtifactProfile(packageId)
  const allowedPackageRootFiles = new Set(profile.allowedPackageRootFiles)
  for (const { path } of manifest.files) {
    if (
      path
        .split('/')
        .some(
          (segment) =>
            segment.toLowerCase() === 'node_modules' || segment.toLowerCase() === '.pnpm',
        )
    ) {
      failures.push(`packed tarball contains a dependency shadow path: ${path}`)
    }
    if (path.toLowerCase().endsWith('package.json') && path !== 'package.json') {
      failures.push(`packed tarball contains a nested package boundary: ${path}`)
    }
    if (
      path.startsWith('dist/runtime/convex-auth/component/_generated/') &&
      /\.d\.(?:m|c)?ts$/u.test(path) &&
      path !== 'dist/runtime/convex-auth/component/_generated/component.d.ts'
    ) {
      failures.push(`packed tarball contains an unreachable generated declaration: ${path}`)
    }
    if (!path.startsWith('dist/') && !allowedPackageRootFiles.has(path)) {
      failures.push(`packed tarball contains an unplanned root path: ${path}`)
    }
    if (path.includes('/.output/') || path.startsWith('.output/')) {
      failures.push(`packed tarball contains raw build output: ${path}`)
    }
    if (
      path.startsWith('dist/runtime/devtools/ui/') &&
      !path.startsWith('dist/runtime/devtools/ui/dist/')
    ) {
      failures.push(`packed tarball contains raw DevTools UI source: ${path}`)
    }
    if (path.startsWith('dist/runtime/devtools/ui/dist/') && /\.d\.(?:m|c)?ts$/.test(path)) {
      failures.push(`packed tarball contains a declaration generated for a static asset: ${path}`)
    }
    if (
      path === 'dist/runtime/server/tsconfig.json' ||
      /(?:^|\/)tsconfig\.tsbuildinfo$/.test(path)
    ) {
      failures.push(`packed tarball contains generated build configuration: ${path}`)
    }
  }
}

export function checkRequiredPackedFiles(packageId, manifest, failures) {
  const { profile } = getPackedArtifactProfile(packageId)
  const packedFiles = new Set(manifest.files.map(({ path }) => path))
  for (const path of profile.requiredPackedFiles) {
    if (!packedFiles.has(path)) failures.push(`packed tarball is missing required file: ${path}`)
  }
}

export function scanExtractedTarball(packageId, packageDir, failures, manifest) {
  const { descriptor, profile } = getPackedArtifactProfile(packageId)
  checkPackedPathClasses(packageId, manifest, failures)
  checkRequiredPackedFiles(packageId, manifest, failures)
  const packedPackageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  if (packedPackageJson.name !== descriptor.packageName) {
    failures.push(
      `packed package name ${String(packedPackageJson.name)} does not match ${descriptor.packageName}`,
    )
  }
  const runtimeDeclaredPackages = new Set([
    ...Object.keys(packedPackageJson.dependencies ?? {}),
    ...Object.keys(packedPackageJson.peerDependencies ?? {}),
    ...Object.keys(packedPackageJson.optionalDependencies ?? {}),
  ])
  const allowedHostPackages = new Set(profile.allowedHostPackages)
  const allowedVirtualSpecifiers = new Set(profile.allowedVirtualSpecifiers)
  const bins =
    typeof packedPackageJson.bin === 'string'
      ? [[packedPackageJson.name, packedPackageJson.bin]]
      : Object.entries(packedPackageJson.bin ?? {})
  for (const [command, target] of bins) {
    if (typeof target !== 'string') {
      failures.push(`packed package bin["${command}"] has a non-string target`)
      continue
    }
    const normalizedTarget = target.replace(/^\.\//, '')
    const absoluteTarget = resolve(packageDir, normalizedTarget)
    if (!staysInside(packageDir, absoluteTarget) || absoluteTarget === packageDir) {
      failures.push(`packed package bin["${command}"] escapes the package: ${target}`)
      continue
    }
    const manifestEntry = manifest.files.find((entry) => entry.path === normalizedTarget)
    if (!manifestEntry || !existsSync(absoluteTarget)) {
      failures.push(`packed package bin["${command}"] target is missing: ${target}`)
      continue
    }
    if (!readFileSync(absoluteTarget, 'utf8').startsWith('#!/usr/bin/env node\n')) {
      failures.push(`packed package bin["${command}"] target is missing its Node shebang`)
    }
    if ((Number.parseInt(manifestEntry.mode, 8) & 0o111) === 0) {
      failures.push(`packed package bin["${command}"] target is not executable`)
    }
  }
  const distDir = join(packageDir, 'dist')
  const files = walkDir(distDir, new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json']))
  checkArtifactJavaScriptProgram(
    files.filter(
      (file) =>
        (file.endsWith('.js') || file.endsWith('.mjs')) &&
        !isBuiltDevtoolsBrowserAsset(packageDir, file),
    ),
    failures,
    packageDir,
  )
  checkArtifactDeclarationProgram(
    files.filter(
      (file) => file.endsWith('.d.ts') || file.endsWith('.d.mts') || file.endsWith('.d.cts'),
    ),
    failures,
    packageDir,
  )

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(packageDir, file)

    for (const match of text.matchAll(ABS_PATH_RE)) {
      failures.push(
        `packed ${rel} contains a source-machine absolute path: "${match[0].slice(0, 120)}"`,
      )
    }
    for (const match of text.matchAll(ALIAS_RE)) {
      failures.push(`packed ${rel} contains an app-specific alias leak: "${match[1] ?? match[0]}"`)
    }

    // These files are the opaque static output of Nuxt's browser bundler, not
    // Node/package modules. They still receive archive, path, size, absolute
    // path, and alias-leak checks; their module graph is owned by the generated
    // HTML/chunk manifest and exercised by the packed consumer.
    if (isBuiltDevtoolsBrowserAsset(packageDir, file)) continue

    if (extname(file) === '.json') continue
    if (file.endsWith('.cjs')) {
      failures.push(`packed ${rel} uses unsupported CommonJS runtime syntax`)
      continue
    }
    if (file.endsWith('.js') || file.endsWith('.mjs')) {
      checkNodeModuleSyntax(file, rel, failures)
    }

    let inspection
    try {
      inspection = inspectModuleFile(file)
    } catch (error) {
      failures.push(`packed ${rel} could not be parsed: ${error.message}`)
      continue
    }
    if (inspection.diagnosticCodes.length > 0) {
      failures.push(
        `packed ${rel} has TypeScript parse error(s): ${inspection.diagnosticCodes.join(', ')}`,
      )
      continue
    }
    const specifiers = [...inspection.specifiers]
    for (const directive of inspection.sourceFile.typeReferenceDirectives) {
      specifiers.push(directive.fileName)
    }
    if (file.endsWith('.d.ts') || file.endsWith('.d.mts') || file.endsWith('.d.cts')) {
      for (const directive of inspection.sourceFile.libReferenceDirectives) {
        if (!isKnownTypeScriptLibReference(directive.fileName)) {
          failures.push(
            `packed ${rel} has unknown TypeScript lib reference "${directive.fileName}"`,
          )
        }
      }
      for (const directive of inspection.sourceFile.referencedFiles) {
        if (!resolveArtifactReferencePathEdge(packageDir, file, directive.fileName)) {
          failures.push(`packed ${rel} has unresolved types reference path "${directive.fileName}"`)
        }
      }
    }
    for (const specifier of specifiers) {
      if (specifier.startsWith('<')) {
        failures.push(`packed ${rel} uses ${specifier.slice(1, -1)}`)
        continue
      }
      if (specifier.startsWith('.')) {
        const graphKind =
          file.endsWith('.d.ts') || file.endsWith('.d.mts') || file.endsWith('.d.cts')
            ? 'types'
            : 'runtime'
        if (!resolveArtifactModuleEdge(packageDir, file, specifier, graphKind)) {
          failures.push(`packed ${rel} has unresolved ${graphKind} edge "${specifier}"`)
        }
        continue
      }
      if (specifier.startsWith('#')) {
        if (!allowedVirtualSpecifiers.has(specifier)) {
          failures.push(`packed ${rel} imports unreviewed virtual specifier "${specifier}"`)
        }
        continue
      }
      if (nodeBuiltins.has(specifier)) continue
      if (specifier.startsWith('node:')) {
        failures.push(`packed ${rel} imports unknown Node builtin "${specifier}"`)
        continue
      }
      // The published `dist/` ships browser-runtime and Nitro-runtime files
      // that legitimately expect their host (a Nuxt/Vue/Nitro app) to provide
      // these — they are peer/host runtime, not an undeclared dependency of
      // this package. `/errors`, the only framework-free entry today, is
      // separately covered by the stricter per-entry purity guard above.
      if (allowedHostPackages.has(rootPackageName(specifier))) continue
      const packageName = rootPackageName(specifier)
      if (!runtimeDeclaredPackages.has(packageName)) {
        failures.push(
          `packed ${rel} resolves undeclared dependency "${packageName}" via "${specifier}"`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pack + extract
// ---------------------------------------------------------------------------

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options })
}

export function requireDistBuilt(packageId) {
  const { packageRoot, profile } = getPackedArtifactProfile(packageId)
  const missing = profile.requiredBuildFiles.filter(
    (file) => !existsSync(resolve(packageRoot, file)),
  )
  if (missing.length > 0) {
    console.error(
      `check:package-exports requires a built dist/. Missing: ${missing.join(', ')}.\n` +
        `Run \`${profile.buildHint}\` (or the selected package's prepack script) first.`,
    )
    process.exit(1)
  }
}

/** @returns {{ scratchDir: string, tarballPath: string, packageDir: string, archiveEntries: object[] }} the scratch directory holding the pack, the tarball's absolute path, the extracted package directory, and validated archive headers */
export function packAndExtract(packageId, tarballInput) {
  const { packageRoot } = getPackedArtifactProfile(packageId)
  const scratchDir = mkdtempSync(join(tmpdir(), 'bcn-packed-entry-'))
  let tarballPath = tarballInput ? resolve(repoRoot, tarballInput) : undefined
  if (!tarballPath) {
    let packResults
    try {
      const out = run(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchDir],
        { cwd: packageRoot },
      )
      packResults = JSON.parse(out)
    } catch (error) {
      console.error(`\`npm pack\` failed: ${error.message}`)
      process.exit(1)
    }
    if (
      !Array.isArray(packResults) ||
      packResults.length !== 1 ||
      typeof packResults[0]?.filename !== 'string' ||
      packResults[0].filename.length === 0
    ) {
      console.error('`npm pack --json` must produce exactly one package result with a filename.')
      process.exit(1)
    }
    tarballPath = resolve(scratchDir, packResults[0].filename)
    if (!staysInside(scratchDir, tarballPath)) {
      console.error(`npm pack produced a tarball outside its scratch directory: ${tarballPath}`)
      process.exit(1)
    }
  }
  if (!tarballPath || !existsSync(tarballPath)) {
    console.error(`Expected tarball does not exist: ${tarballPath ?? '<missing path>'}.`)
    process.exit(1)
  }

  let archiveEntries
  try {
    archiveEntries = inspectTarballArchive(packageId, tarballPath)
  } catch (error) {
    console.error(`Packed tarball archive preflight failed: ${error.message}`)
    process.exit(1)
  }

  const extractDir = join(scratchDir, 'extracted')
  mkdirSync(extractDir, { recursive: true })
  try {
    tar.x({ cwd: extractDir, file: tarballPath, strict: true, sync: true })
  } catch (error) {
    console.error(`Failed to extract packed tarball: ${error.message}`)
    process.exit(1)
  }
  const packageDir = join(extractDir, 'package')
  if (!existsSync(packageDir)) {
    console.error(`Expected extracted package directory missing: ${packageDir}`)
    process.exit(1)
  }
  const packageStats = lstatSync(packageDir)
  const canonicalExtractDir = realpathSync(extractDir)
  const canonicalPackageDir = realpathSync(packageDir)
  if (
    packageStats.isSymbolicLink() ||
    !packageStats.isDirectory() ||
    canonicalPackageDir !== resolve(canonicalExtractDir, 'package') ||
    !staysInside(canonicalExtractDir, canonicalPackageDir)
  ) {
    console.error(`Extracted package root is not one canonical directory: ${packageDir}`)
    process.exit(1)
  }

  return { scratchDir, tarballPath, packageDir: canonicalPackageDir, archiveEntries }
}

// ---------------------------------------------------------------------------
