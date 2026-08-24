#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  assertCandidateAppLockTextBindsArtifact,
  candidateAppInstallArgs,
  candidateAppLockProfiles,
  createCandidateRegistryMetadata,
  packageArtifactIdentity,
  withCandidateReleaseAgeExclusions,
} from './candidate-app-locks.mjs'
import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'
import { assertPackedRuntimeFingerprintBinding } from './package-runtime-fingerprint-profile.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const options = parseArguments(process.argv.slice(2))

function parseArguments(args) {
  const values = new Map()
  let check = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--check') {
      if (check) throw new Error('Duplicate --check argument.')
      check = true
      continue
    }
    if (!['--tarball', '--vue-tarball', '--mcp-tarball'].includes(argument)) {
      throw new Error(usage())
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--') || values.has(argument)) throw new Error(usage())
    values.set(argument, value)
    index += 1
  }
  if (values.size !== 3) throw new Error(usage())
  return {
    check,
    mcpTarball: values.get('--mcp-tarball'),
    nuxtTarball: values.get('--tarball'),
    vueTarball: values.get('--vue-tarball'),
  }
}

function usage() {
  return 'Usage: node scripts/update-candidate-app-locks.mjs --tarball <better-convex-nuxt.tgz> --vue-tarball <better-convex-vue.tgz> --mcp-tarball <better-convex-mcp.tgz> [--check]'
}

function readCandidateTarball(packageId, path) {
  const tarballPath = resolve(repoRoot, path)
  const stats = existsSync(tarballPath) ? lstatSync(tarballPath) : undefined
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Candidate tarball must be a regular file: ${tarballPath}`)
  }
  const tarball = readFileSync(tarballPath)
  const packageJson = JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  )
  const coordinates = getPackageArtifactCoordinates(packageId, { repositoryRoot: repoRoot })
  if (packageJson.name !== coordinates.packageName || packageJson.version !== coordinates.version) {
    throw new Error(
      `Candidate tarball does not match reviewed ${coordinates.packageName}@${coordinates.version}.`,
    )
  }
  assertPackedRuntimeFingerprintBinding(packageId, coordinates.version, tarballPath)
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  return {
    artifact: packageArtifactIdentity(packageId, coordinates.version, integrity),
    packageId,
    metadataPath: `/${packageJson.name.replaceAll('/', '%2F')}`,
    integrity,
    packageJson,
    tarball,
    tarballPathname: `/${packageJson.name}/-/${packageJson.name.split('/').at(-1)}-${packageJson.version}.tgz`,
    tarballPath,
  }
}

const candidates = [
  readCandidateTarball('nuxt', options.nuxtTarball),
  readCandidateTarball('vue', options.vueTarball),
  readCandidateTarball('mcp', options.mcpTarball),
]
const [nuxtCandidate, vueCandidate] = candidates
if (
  nuxtCandidate.packageJson.dependencies?.['@lupinum/better-convex-vue'] !==
  vueCandidate.packageJson.version
) {
  throw new Error('Candidate tarballs do not form the reviewed exact Vue/Nuxt/MCP package set.')
}
const originalLocks = new Map(
  candidateAppLockProfiles.map(({ directory }) => {
    const lockPath = join(repoRoot, directory, 'pnpm-lock.yaml')
    return [lockPath, readFileSync(lockPath, 'utf8')]
  }),
)
const updatedLocks = new Map()

function runPnpm(profile, directory, registry, frozen) {
  return new Promise((resolvePromise, reject) => {
    const installArgs = candidateAppInstallArgs(profile, frozen)
    console.log(`\n> pnpm ${installArgs.join(' ')} (${directory})`)
    const child = spawn('pnpm', installArgs, {
      cwd: resolve(repoRoot, directory),
      env: {
        ...process.env,
        npm_config_registry: registry,
        PNPM_CONFIG_REGISTRY: registry,
      },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`pnpm exited with ${signal ?? code} for ${directory}`))
    })
  })
}

let registry
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', registry)
    const candidate = candidates.find(
      ({ metadataPath, tarballPathname }) =>
        url.pathname.toLowerCase() === metadataPath.toLowerCase() ||
        url.pathname === tarballPathname,
    )
    if (candidate && url.pathname.toLowerCase() === candidate.metadataPath.toLowerCase()) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(createCandidateRegistryMetadata({ ...candidate, registry })))
      return
    }
    if (candidate) {
      response.setHeader('content-type', 'application/octet-stream')
      response.end(candidate.tarball)
      return
    }

    await new Promise((resolvePromise, reject) => {
      const upstreamRequest = httpsRequest(
        {
          headers: { accept: request.headers.accept ?? '*/*' },
          hostname: 'registry.npmjs.org',
          method: 'GET',
          path: `${url.pathname}${url.search}`,
          protocol: 'https:',
        },
        (upstreamResponse) => {
          response.statusCode = upstreamResponse.statusCode ?? 502
          for (const [name, value] of Object.entries(upstreamResponse.headers)) {
            if (
              value !== undefined &&
              !['content-encoding', 'content-length', 'transfer-encoding'].includes(name)
            ) {
              response.setHeader(name, value)
            }
          }
          upstreamResponse.on('error', reject)
          upstreamResponse.on('end', resolvePromise)
          upstreamResponse.pipe(response)
        },
      )
      upstreamRequest.on('error', reject)
      upstreamRequest.end()
    })
  } catch {
    response.statusCode = 502
    response.end('Upstream registry request failed')
  }
})

await new Promise((resolvePromise, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolvePromise)
})
const address = server.address()
if (!address || typeof address === 'string') {
  server.close()
  throw new Error('Could not determine the temporary registry port')
}
registry = `http://127.0.0.1:${address.port}/`
const validationRoot = mkdtempSync(join(tmpdir(), 'bcn-candidate-locks-'))

try {
  for (const profile of candidateAppLockProfiles) {
    const { directory } = profile
    const lockPath = join(repoRoot, directory, 'pnpm-lock.yaml')
    const validationDir = join(validationRoot, directory)
    mkdirSync(validationDir, { recursive: true })
    for (const filename of ['package.json', 'pnpm-workspace.yaml', '.npmrc']) {
      const sourcePath = join(repoRoot, directory, filename)
      if (existsSync(sourcePath)) copyFileSync(sourcePath, join(validationDir, filename))
    }
    const validationLockPath = join(validationDir, 'pnpm-lock.yaml')
    const requiredCandidates = candidates.filter(({ packageId }) =>
      profile.packageIds.includes(packageId),
    )
    const validationWorkspacePath = join(validationDir, 'pnpm-workspace.yaml')
    if (existsSync(validationWorkspacePath)) {
      writeFileSync(
        validationWorkspacePath,
        withCandidateReleaseAgeExclusions(
          readFileSync(validationWorkspacePath, 'utf8'),
          requiredCandidates.map(({ artifact }) => artifact),
        ),
      )
    }
    if (options.check) {
      const committedLock = originalLocks.get(lockPath)
      for (const { artifact } of requiredCandidates) {
        assertCandidateAppLockTextBindsArtifact(committedLock, profile, artifact)
      }
      writeFileSync(validationLockPath, committedLock)
      await runPnpm(profile, validationDir, registry, true)
      if (readFileSync(validationLockPath, 'utf8') !== committedLock) {
        throw new Error(`${directory}/pnpm-lock.yaml changed during frozen validation`)
      }
      updatedLocks.set(lockPath, committedLock)
      continue
    }
    // Regenerate from the maintained manifest and workspace policy. Reusing a
    // prior lock would preserve obsolete peer snapshots across toolchain or
    // upstream metadata changes and make a strict install report false errors.
    await runPnpm(profile, validationDir, registry, false)
    const lock = readFileSync(validationLockPath, 'utf8')
    // Requests proxied through the temporary registry otherwise make pnpm
    // spell every ordinary npm resolution with a redundant explicit tarball
    // URL. Strip only that default-registry noise; integrity hashes remain.
    const normalizedLock = lock
      .replace(/, tarball: https:\/\/registry\.npmjs\.org\/[^\n]+\}/g, '}')
      .replace(/, tarball: http:\/\/127\.0\.0\.1:\d+\/[^\n]+\}/g, '}')
    for (const { artifact } of requiredCandidates) {
      assertCandidateAppLockTextBindsArtifact(normalizedLock, profile, artifact)
    }
    // The candidate manifests are part of the release contract. Preserve the
    // complete lock pnpm regenerated from those manifests; merging only the
    // module's own blocks would retain removed peers and stale importer specs.
    writeFileSync(validationLockPath, normalizedLock)
    await runPnpm(profile, validationDir, registry, true)
    if (readFileSync(validationLockPath, 'utf8') !== normalizedLock) {
      throw new Error(`${directory}/pnpm-lock.yaml changed during frozen validation`)
    }
    updatedLocks.set(lockPath, normalizedLock)
  }
  if (options.check) {
    console.log(
      `\nVerified ${candidateAppLockProfiles.length} candidate app lockfiles against the exact Vue/Nuxt/MCP candidate set.`,
    )
  } else {
    for (const [lockPath, updatedLock] of updatedLocks) writeFileSync(lockPath, updatedLock)
    console.log(
      `\nUpdated ${candidateAppLockProfiles.length} candidate app lockfiles from the exact Vue/Nuxt/MCP candidate set.`,
    )
  }
} catch (error) {
  if (!options.check) {
    for (const [lockPath, originalLock] of originalLocks) {
      writeFileSync(lockPath, originalLock)
    }
  }
  throw error
} finally {
  const closed = new Promise((resolvePromise) => server.close(resolvePromise))
  server.closeAllConnections()
  await closed
  rmSync(validationRoot, { recursive: true, force: true })
}
