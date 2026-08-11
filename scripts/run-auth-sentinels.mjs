#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createSecretSentinels,
  scanSecretSentinelSurfaces,
  sentinelEncodings,
} from './auth-secret-sentinels.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_PACKED_FILE_BYTES = 16 * 1024 * 1024
const MAX_PACKED_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_PACKED_FILES = 5_000
const SKIPPED_SNAPSHOT_DIRECTORIES = new Set([
  '.agents',
  '.audit',
  '.codex',
  '.convex',
  '.git',
  '.nuxt',
  '.output',
  '.pnpm-store',
  '.release-artifacts',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
])

function fail(message) {
  throw new Error(message)
}

function parseArguments(argv) {
  let tarball = process.env.BCN_RELEASE_TARBALL || undefined
  let runId
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--tarball') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail('--tarball requires one path')
      if (tarball && path.resolve(tarball) !== path.resolve(value)) {
        fail('--tarball conflicts with BCN_RELEASE_TARBALL')
      }
      tarball = value
      continue
    }
    if (argument === '--run-id') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail('--run-id requires one value')
      runId = value
      continue
    }
    fail(`Unknown auth secret sentinel option: ${argument}`)
  }
  return {
    runId: runId ?? `bcn-${randomUUID()}`,
    tarball: tarball ? path.resolve(repoRoot, tarball) : undefined,
  }
}

function safeFailureMessage(error, sentinels) {
  let message = error instanceof Error ? error.message : String(error)
  for (const value of Object.values(sentinels)) {
    for (const encoding of sentinelEncodings(value)) {
      message = message.replaceAll(encoding.value, '[REDACTED]')
    }
  }
  return message.replace(/[\r\n]+/gu, ' ')
}

function scanCommandOutput(sentinels, label, result) {
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '')
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '')
  scanSecretSentinelSurfaces(sentinels, [
    { category: 'console', location: `console.command.${label}.stdout`, value: stdout },
    { category: 'console', location: `console.command.${label}.stderr`, value: stderr },
  ])
  return { stderr, stdout }
}

function runCaptured(sentinels, label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'buffer',
    env: options.env ?? process.env,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  })
  const output = scanCommandOutput(sentinels, label, result)
  if (result.error) fail(`${label} could not start (${result.error.code ?? 'unknown error'})`)
  if (result.signal) fail(`${label} terminated by ${result.signal}`)
  if (result.status !== 0) fail(`${label} exited with status ${result.status ?? 'unknown'}`)
  return output.stdout.toString('utf8')
}

function requireFile(file, label) {
  if (!existsSync(file) || !lstatSync(file).isFile()) fail(`${label} is not one regular file`)
  return realpathSync(file)
}

function packCurrentTree(sentinels, scratchDirectory, childEnvironment) {
  runCaptured(sentinels, 'prepack', 'pnpm', ['run', 'prepack'], { env: childEnvironment })
  const output = runCaptured(
    sentinels,
    'npm-pack',
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchDirectory],
    { env: childEnvironment },
  )
  let result
  try {
    result = JSON.parse(output)
  } catch {
    fail('npm-pack returned invalid JSON')
  }
  const filename = result?.[0]?.filename
  if (typeof filename !== 'string' || path.basename(filename) !== filename) {
    fail('npm-pack returned an unsafe artifact filename')
  }
  return requireFile(path.join(scratchDirectory, filename), 'packed tarball')
}

function validateTarEntries(listing) {
  const entries = listing.split(/\r?\n/gu).filter(Boolean)
  if (entries.length === 0) fail('packed tarball is empty')
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry)
    if (
      entry.includes('\0') ||
      path.posix.isAbsolute(entry) ||
      normalized !== entry ||
      (entry !== 'package' && entry !== 'package/' && !entry.startsWith('package/'))
    ) {
      fail('packed tarball contains an unsafe path')
    }
  }
}

function extractTarball(sentinels, tarball, scratchDirectory) {
  const listing = runCaptured(sentinels, 'tar-list', 'tar', ['-tzf', tarball])
  validateTarEntries(listing)
  const extracted = path.join(scratchDirectory, 'extracted')
  mkdirSync(extracted, { mode: 0o700 })
  runCaptured(sentinels, 'tar-extract', 'tar', ['-xzf', tarball, '-C', extracted])
  const packageDirectory = path.join(extracted, 'package')
  if (!existsSync(packageDirectory) || !lstatSync(packageDirectory).isDirectory()) {
    fail('packed tarball has no package directory')
  }
  return packageDirectory
}

function walkRegularFiles(root, options = {}) {
  const files = []
  let totalBytes = 0

  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (options.skipDirectories?.has(name)) continue
      const absolute = path.join(directory, name)
      const stats = lstatSync(absolute)
      if (stats.isSymbolicLink()) {
        if (options.skipSymbolicLinks) continue
        fail('secret sentinel scan refuses symbolic links')
      }
      if (stats.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!stats.isFile()) fail('secret sentinel scan refuses special files')
      if (options.filter && !options.filter(absolute)) continue
      if (stats.size > MAX_PACKED_FILE_BYTES) fail('secret sentinel scan file bound exceeded')
      totalBytes += stats.size
      if (totalBytes > MAX_PACKED_TOTAL_BYTES) fail('secret sentinel scan byte bound exceeded')
      files.push(absolute)
      if (files.length > MAX_PACKED_FILES) fail('secret sentinel scan file-count bound exceeded')
    }
  }

  if (existsSync(root)) walk(root)
  return files
}

function fileSurfaces(files, category, root, prefix) {
  return files.map((file) => ({
    category,
    location: `${prefix}.${path.relative(root, file).split(path.sep).join('/')}`,
    value: readFileSync(file),
  }))
}

function scanArtifacts(sentinels, tarball, packageDirectory) {
  const packageFiles = walkRegularFiles(packageDirectory)
  const distDirectory = path.join(packageDirectory, 'dist')
  if (!existsSync(distDirectory) || !lstatSync(distDirectory).isDirectory()) {
    fail('packed tarball has no dist build output')
  }
  const buildFiles = packageFiles.filter((file) => file.startsWith(`${distDirectory}${path.sep}`))
  const sourceMaps = packageFiles.filter((file) => file.endsWith('.map'))
  const snapshots = walkRegularFiles(repoRoot, {
    filter: (file) => file.endsWith('.snap'),
    skipDirectories: SKIPPED_SNAPSHOT_DIRECTORIES,
    skipSymbolicLinks: true,
  })

  const surfaces = [
    { category: 'tarball', location: 'tarball.compressed-bytes', value: readFileSync(tarball) },
    ...fileSurfaces(packageFiles, 'tarball', packageDirectory, 'tarball.extracted'),
    ...fileSurfaces(buildFiles, 'build-output', packageDirectory, 'build-output'),
    ...fileSurfaces(sourceMaps, 'source-map', packageDirectory, 'source-map'),
    ...fileSurfaces(snapshots, 'snapshot', repoRoot, 'snapshot'),
  ]
  const report = scanSecretSentinelSurfaces(sentinels, surfaces)
  return {
    buildFiles: buildFiles.length,
    leaves: report.leavesScanned,
    packageFiles: packageFiles.length,
    snapshots: snapshots.length,
    sourceMaps: sourceMaps.length,
  }
}

const options = parseArguments(process.argv.slice(2))
const sentinels = createSecretSentinels(options.runId)
const scratchDirectory = mkdtempSync(path.join(tmpdir(), 'bcn-auth-sentinels-'))
chmodSync(scratchDirectory, 0o700)

try {
  const childEnvironment = {
    ...process.env,
    BCN_AUTH_PROXY_IP_SECRET: sentinels['proxy-ip-secret'],
    BCN_AUTH_SENTINEL_RUN_ID: options.runId,
    BETTER_AUTH_SECRETS: `2:${sentinels['better-auth-current-secret']},1:${sentinels['better-auth-prior-secret']}`,
    MCP_PROXY_AUTH_TOKEN: sentinels['inspector-proxy-token'],
    npm_config_cache: path.join(scratchDirectory, 'npm-cache'),
  }
  runCaptured(
    sentinels,
    'runtime-suite',
    'pnpm',
    ['exec', 'vitest', 'run', '--project=auth-sentinels'],
    {
      env: childEnvironment,
    },
  )

  const tarball = options.tarball
    ? requireFile(options.tarball, 'supplied tarball')
    : packCurrentTree(sentinels, scratchDirectory, childEnvironment)
  const packageDirectory = extractTarball(sentinels, tarball, scratchDirectory)
  const report = scanArtifacts(sentinels, tarball, packageDirectory)
  console.log(
    `[auth-secret-sentinels] PASS: ${sentinelCount(sentinels)} active classes; ` +
      `${report.packageFiles} packed files, ${report.buildFiles} build files, ` +
      `${report.sourceMaps} source maps, ${report.snapshots} snapshots, ` +
      `${report.leaves} artifact leaves; runtime database/HTTP/error/console/DevTools surfaces clean.`,
  )
} catch (error) {
  console.error(`[auth-secret-sentinels] FAIL: ${safeFailureMessage(error, sentinels)}`)
  process.exitCode = 1
} finally {
  rmSync(scratchDirectory, { force: true, recursive: true })
}

function sentinelCount(values) {
  return Object.keys(values).length
}
