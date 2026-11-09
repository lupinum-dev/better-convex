// The pinned local Convex backend used by E2E and the integration suite.
//
// `convex dev --local-backend-version <v>` would download any binary it is
// given. Tests install the reviewed release themselves first, checking the
// archive and binary SHA-256 from local-backend.json, so the CLI only ever
// finds the reviewed binary in its cache. `createLocalDeployment` keeps the CLI
// from fetching the newest backend for a new deployment's keys.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const maximumArchiveBytes = 128 * 1024 * 1024
const executable = 'convex-local-backend'

function fail(message) {
  throw new Error(`[local-backend] ${message}`)
}

export function loadBackendManifest() {
  const manifest = JSON.parse(
    readFileSync(new URL('./local-backend.json', import.meta.url), 'utf8'),
  )
  const convex = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies
    ?.convex
  // The backend release is reviewed together with the Convex CLI that drives it.
  if (manifest.convexVersion !== convex) {
    fail(`local-backend.json pairs convex ${manifest.convexVersion}, package.json has ${convex}`)
  }
  return manifest
}

function selectArtifact(manifest) {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.platform === process.platform && candidate.arch === process.arch,
  )
  if (!artifact) fail(`no reviewed backend for ${process.platform}-${process.arch}`)
  return artifact
}

function backendBinaryPath(version) {
  return path.join(os.homedir(), '.cache', 'convex', 'binaries', version, executable)
}

async function sha256File(filename) {
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(filename)) hash.update(chunk)
  } catch {
    return undefined
  }
  return hash.digest('hex')
}

async function download(url, filename) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await rm(filename, { force: true })
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok || !response.body) fail(`download failed with HTTP ${response.status}`)
      if (new URL(response.url || url).protocol !== 'https:') fail('download left HTTPS')
      let received = 0
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length
          callback(received > maximumArchiveBytes ? new Error('archive too large') : null, chunk)
        },
      })
      await pipeline(
        Readable.fromWeb(response.body),
        limit,
        createWriteStream(filename, { flags: 'wx', mode: 0o600 }),
      )
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
    }
  }
  fail(`download failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function unzip(args) {
  const result = spawnSync('unzip', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`unzip ${args[0]} failed: ${result.stderr.trim()}`)
  return result.stdout
}

async function install(manifest, artifact, destination) {
  const directory = path.dirname(destination)
  await mkdir(directory, { recursive: true })
  const temporary = await mkdtemp(path.join(directory, '.verified-install-'))
  try {
    const archive = path.join(temporary, artifact.filename)
    await download(
      `https://github.com/get-convex/convex-backend/releases/download/${manifest.backendVersion}/${artifact.filename}`,
      archive,
    )
    const archiveDigest = await sha256File(archive)
    if (archiveDigest !== artifact.archiveSha256) fail(`archive SHA-256 mismatch: ${archiveDigest}`)
    const entries = unzip(['-Z1', archive]).split(/\r?\n/u).filter(Boolean)
    if (entries.length !== 1 || entries[0] !== executable) {
      fail(`archive must contain exactly ${executable}`)
    }
    unzip(['-qq', archive, executable, '-d', temporary])
    const extracted = path.join(temporary, executable)
    const binaryDigest = await sha256File(extracted)
    if (binaryDigest !== artifact.sha256) fail(`binary SHA-256 mismatch: ${binaryDigest}`)
    await chmod(extracted, 0o755)
    await rename(extracted, destination)
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
}

let pending

/** Verify the reviewed backend binary, downloading and verifying it first when it is missing or altered. */
export function ensureLocalBackend() {
  pending ??= (async () => {
    const manifest = loadBackendManifest()
    const artifact = selectArtifact(manifest)
    const filename = backendBinaryPath(manifest.backendVersion)
    if ((await sha256File(filename)) !== artifact.sha256) {
      await install(manifest, artifact, filename)
    }
    return Object.freeze({ filename, sha256: artifact.sha256, version: manifest.backendVersion })
  })()
  pending.catch(() => {
    pending = undefined
  })
  return pending
}

/**
 * Give a project that has no local deployment yet one on the reviewed backend.
 *
 * For a new anonymous deployment, `convex dev` 1.48 generates the admin key with
 * the newest backend, which it downloads from GitHub whatever
 * `--local-backend-version` says (`generateLocalDevSecretsWithLatestBinary`).
 * That runs an unreviewed binary, and the start fails whenever the download does.
 * The CLI keeps the key of a deployment that already exists, so creating it here
 * with the reviewed binary leaves the CLI nothing to download.
 */
export async function createLocalDeployment(projectDir, ports) {
  const stateDir = path.join(projectDir, '.convex', 'local', 'default')
  if (existsSync(path.join(stateDir, 'config.json'))) return
  const backend = await ensureLocalBackend()
  // The name `convex dev` gives a new deployment under CONVEX_AGENT_MODE=anonymous.
  const deploymentName = 'anonymous-agent'
  const instanceSecret = randomBytes(32).toString('hex')
  const keygen = spawnSync(
    backend.filename,
    ['keygen', 'admin-key', '--instance-name', deploymentName, '--instance-secret', instanceSecret],
    { encoding: 'utf8', timeout: 30_000 },
  )
  if (keygen.status !== 0) {
    fail(`admin key generation failed: ${keygen.stderr || keygen.error || keygen.signal}`)
  }
  await mkdir(stateDir, { recursive: true })
  // The file holds the admin key. Write it whole, or not at all: a partial file
  // would make the next start skip this step and let the CLI download again.
  const partial = path.join(stateDir, `config.json.${process.pid}.tmp`)
  await writeFile(
    partial,
    JSON.stringify({
      ports,
      backendVersion: backend.version,
      adminKey: keygen.stdout.trim(),
      instanceSecret,
      deploymentName,
    }),
    { mode: 0o600 },
  )
  await rename(partial, path.join(stateDir, 'config.json'))
}
