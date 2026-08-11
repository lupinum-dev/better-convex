#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = path.join(root, 'security/local-convex-backend.json')
const packagePath = path.join(root, 'package.json')
const digestPattern = /^[a-f0-9]{64}$/
const versionPattern = /^precompiled-\d{4}-\d{2}-\d{2}-[a-f0-9]{7}$/
const maximumArchiveBytes = 128 * 1024 * 1024
const downloadTimeoutMs = 120_000
const backendExecutable = 'convex-local-backend'

function fail(message) {
  throw new Error(`[auth-backend] ${message}`)
}

export function validateBackendManifest(value, packageManifest) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('manifest must be an object')
  }
  if (value.schemaVersion !== 1) fail('unsupported manifest schemaVersion')
  if (!versionPattern.test(value.backendVersion ?? '')) fail('invalid backendVersion')
  if (typeof value.convexVersion !== 'string' || value.convexVersion.length === 0) {
    fail('convexVersion is required')
  }
  if (
    packageManifest?.peerDependencies?.convex !== value.convexVersion ||
    packageManifest?.devDependencies?.convex !== value.convexVersion
  ) {
    fail('manifest convexVersion must equal the exact peer and development dependency')
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    fail('artifacts must be a non-empty array')
  }

  const keys = new Set()
  for (const artifact of value.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      fail('each artifact must be an object')
    }
    const key = `${artifact.platform}-${artifact.arch}`
    if (keys.has(key)) fail(`duplicate artifact ${key}`)
    keys.add(key)
    if (!['darwin', 'linux'].includes(artifact.platform)) {
      fail(`unsupported manifest platform ${JSON.stringify(artifact.platform)}`)
    }
    if (!['arm64', 'x64'].includes(artifact.arch)) {
      fail(`unsupported manifest architecture ${JSON.stringify(artifact.arch)}`)
    }
    if (
      typeof artifact.filename !== 'string' ||
      !artifact.filename.startsWith('convex-local-backend-') ||
      !artifact.filename.endsWith('.zip') ||
      artifact.filename.includes('/')
    ) {
      fail(`invalid artifact filename for ${key}`)
    }
    if (!digestPattern.test(artifact.archiveSha256 ?? '')) {
      fail(`invalid archive SHA-256 for ${key}`)
    }
    if (!digestPattern.test(artifact.sha256 ?? '')) fail(`invalid binary SHA-256 for ${key}`)
  }

  for (const required of ['darwin-arm64', 'linux-x64']) {
    if (!keys.has(required)) fail(`required release artifact ${required} is missing`)
  }
  return value
}

export async function loadBackendManifest() {
  const [manifestSource, packageSource] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(packagePath, 'utf8'),
  ])
  return validateBackendManifest(JSON.parse(manifestSource), JSON.parse(packageSource))
}

export function selectBackendArtifact(manifest, platform = process.platform, arch = process.arch) {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.platform === platform && candidate.arch === arch,
  )
  if (!artifact) fail(`no reviewed artifact for ${platform}-${arch}`)
  return artifact
}

export function backendBinaryPath(backendVersion, platform = process.platform) {
  const executable = platform === 'win32' ? `${backendExecutable}.exe` : backendExecutable
  return path.join(os.homedir(), '.cache', 'convex', 'binaries', backendVersion, executable)
}

export function backendArchiveUrl(manifest, artifact) {
  return `https://github.com/get-convex/convex-backend/releases/download/${manifest.backendVersion}/${artifact.filename}`
}

export async function sha256File(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function runUnzip(arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn('unzip', arguments_, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4_096) stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`unzip failed (${signal ?? code}): ${stderr.trim() || 'no details'}`))
    })
  })
}

async function listZipEntries(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-Z1', filename], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (stdout.length > 8_192) {
        child.kill()
        reject(new Error('archive contains an excessive entry listing'))
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4_096) stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(`unzip listing failed (${signal ?? code}): ${stderr.trim() || 'no details'}`),
        )
        return
      }
      resolve(stdout.split(/\r?\n/u).filter(Boolean))
    })
  })
}

async function downloadArchive(url, filename, fetchImplementation = globalThis.fetch) {
  if (typeof fetchImplementation !== 'function') fail('this Node.js runtime does not provide fetch')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), downloadTimeoutMs)
  try {
    const response = await fetchImplementation(url, {
      headers: { 'user-agent': 'better-convex-nuxt-auth-backend-verifier' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) {
      fail(`backend archive download failed with HTTP ${response.status}`)
    }
    if (new URL(response.url || url).protocol !== 'https:') {
      fail('backend archive redirected away from HTTPS')
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maximumArchiveBytes) {
      fail(`backend archive exceeds the ${maximumArchiveBytes}-byte limit`)
    }

    let received = 0
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        if (received > maximumArchiveBytes) {
          callback(new Error(`backend archive exceeds the ${maximumArchiveBytes}-byte limit`))
          return
        }
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      createWriteStream(filename, { flags: 'wx', mode: 0o600 }),
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function installBackendBinary(manifest, options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const artifact = selectBackendArtifact(manifest, platform, arch)
  const destination = options.filename ?? backendBinaryPath(manifest.backendVersion, platform)
  const destinationDirectory = path.dirname(destination)
  await mkdir(destinationDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(path.join(destinationDirectory, '.verified-install-'))
  const archive = path.join(temporaryDirectory, artifact.filename)
  const extractionDirectory = path.join(temporaryDirectory, 'extracted')
  try {
    await downloadArchive(backendArchiveUrl(manifest, artifact), archive, options.fetch)
    const archiveDigest = await sha256File(archive)
    if (archiveDigest !== artifact.archiveSha256) {
      fail(
        `archive SHA-256 mismatch for ${artifact.filename}: expected ${artifact.archiveSha256}, received ${archiveDigest}`,
      )
    }

    const entries = await listZipEntries(archive)
    if (entries.length !== 1 || entries[0] !== backendExecutable) {
      fail(`reviewed archive must contain exactly ${backendExecutable} at its root`)
    }
    await mkdir(extractionDirectory)
    await runUnzip(['-qq', archive, backendExecutable, '-d', extractionDirectory])

    const extracted = path.join(extractionDirectory, backendExecutable)
    const binaryDigest = await sha256File(extracted)
    if (binaryDigest !== artifact.sha256) {
      fail(
        `binary SHA-256 mismatch after extraction: expected ${artifact.sha256}, received ${binaryDigest}`,
      )
    }
    await chmod(extracted, 0o755)
    await rename(extracted, destination)
    return {
      artifact,
      filename: destination,
      sha256: binaryDigest,
      version: manifest.backendVersion,
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

export async function verifyBackendBinary(manifest, options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const artifact = selectBackendArtifact(manifest, platform, arch)
  const filename = options.filename ?? backendBinaryPath(manifest.backendVersion, platform)

  let metadata
  try {
    metadata = await stat(filename)
  } catch {
    fail(
      `reviewed ${platform}-${arch} binary is not installed at ${filename}; run pnpm check:auth-backend --install`,
    )
  }
  if (!metadata.isFile()) fail(`backend path is not a regular file: ${filename}`)
  const actual = await sha256File(filename)
  if (actual !== artifact.sha256) {
    fail(`SHA-256 mismatch for ${filename}: expected ${artifact.sha256}, received ${actual}`)
  }
  return { artifact, filename, sha256: actual, version: manifest.backendVersion }
}

export async function assertCurrentBackendBinary(options = {}) {
  const manifest = await loadBackendManifest()
  return verifyBackendBinary(manifest, options)
}

async function main() {
  const arguments_ = process.argv.slice(2)
  const knownArguments = new Set(['--install', '--manifest-only'])
  const unknown = arguments_.find((argument) => !knownArguments.has(argument))
  if (unknown) fail(`unknown argument ${JSON.stringify(unknown)}`)
  if (arguments_.includes('--install') && arguments_.includes('--manifest-only')) {
    fail('--install and --manifest-only cannot be combined')
  }
  const manifest = await loadBackendManifest()
  if (arguments_.includes('--manifest-only')) {
    console.log(
      `[auth-backend] manifest valid: ${manifest.backendVersion} (${manifest.artifacts.length} reviewed artifacts)`,
    )
    return
  }
  const result = arguments_.includes('--install')
    ? await installBackendBinary(manifest)
    : await verifyBackendBinary(manifest)
  console.log(
    `[auth-backend] ${arguments_.includes('--install') ? 'installed and verified' : 'verified'} ${result.version} for ${result.artifact.platform}-${result.artifact.arch}: ${result.sha256}`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
