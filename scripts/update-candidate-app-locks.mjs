#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
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

import { getMaintainedCandidateProfile } from './maintained-candidate-apps.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const { profile: maintainedCandidateProfile } = getMaintainedCandidateProfile('nuxt')
const maintainedCandidateApps = maintainedCandidateProfile.pnpmApps
const args = process.argv.slice(2)
if (
  args.length !== 6 ||
  args[0] !== '--tarball' ||
  args[2] !== '--vue-tarball' ||
  args[4] !== '--mcp-tarball'
) {
  console.error(
    'Usage: pnpm update:candidate-app-locks --tarball <better-convex-nuxt.tgz> --vue-tarball <better-convex-vue.tgz> --mcp-tarball <better-convex-mcp.tgz>',
  )
  process.exit(1)
}

function readCandidateTarball(path) {
  const tarballPath = resolve(repoRoot, path)
  if (!existsSync(tarballPath)) {
    throw new Error(`Candidate tarball does not exist: ${tarballPath}`)
  }
  const tarball = readFileSync(tarballPath)
  const packageJson = JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  )
  return {
    metadataPath: `/${packageJson.name.replaceAll('/', '%2F')}`,
    integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
    packageJson,
    tarball,
    tarballPathname: `/${packageJson.name}/-/${packageJson.name.split('/').at(-1)}-${packageJson.version}.tgz`,
    tarballPath,
  }
}

const candidates = [
  readCandidateTarball(args[1]),
  readCandidateTarball(args[3]),
  readCandidateTarball(args[5]),
]
const [nuxtCandidate, vueCandidate, mcpCandidate] = candidates
if (
  nuxtCandidate.packageJson.name !== 'better-convex-nuxt' ||
  vueCandidate.packageJson.name !== 'better-convex-vue' ||
  mcpCandidate.packageJson.name !== 'better-convex-mcp' ||
  nuxtCandidate.packageJson.dependencies?.['better-convex-vue'] !== vueCandidate.packageJson.version
) {
  throw new Error('Candidate tarballs do not form the reviewed exact Vue/Nuxt/MCP package set.')
}
const originalLocks = new Map(
  maintainedCandidateApps.map(({ path: directory }) => {
    const lockPath = join(repoRoot, directory, 'pnpm-lock.yaml')
    return [lockPath, readFileSync(lockPath, 'utf8')]
  }),
)
const updatedLocks = new Map()

function runPnpm(directory, registry, frozen) {
  return new Promise((resolvePromise, reject) => {
    const installArgs = frozen
      ? ['install', '--frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies']
      : [
          'install',
          '--lockfile-only',
          '--no-frozen-lockfile',
          '--ignore-scripts',
          '--strict-peer-dependencies',
        ]
    console.log(`\n> pnpm ${installArgs.join(' ')} (${directory})`)
    const child = spawn('pnpm', installArgs, {
      cwd: resolve(repoRoot, directory),
      env: { ...process.env, PNPM_CONFIG_REGISTRY: registry },
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
      const { integrity, packageJson } = candidate
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          name: packageJson.name,
          'dist-tags': { latest: packageJson.version },
          versions: {
            [packageJson.version]: {
              ...packageJson,
              dist: {
                integrity,
                tarball: new URL(candidate.tarballPathname.slice(1), registry).href,
              },
            },
          },
        }),
      )
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
  for (const { path: directory } of maintainedCandidateApps) {
    const lockPath = join(repoRoot, directory, 'pnpm-lock.yaml')
    const validationDir = join(validationRoot, directory)
    mkdirSync(validationDir, { recursive: true })
    for (const filename of ['package.json', 'pnpm-workspace.yaml']) {
      const sourcePath = join(repoRoot, directory, filename)
      if (existsSync(sourcePath)) copyFileSync(sourcePath, join(validationDir, filename))
    }
    const validationManifest = JSON.parse(readFileSync(join(validationDir, 'package.json'), 'utf8'))
    const validationLockPath = join(validationDir, 'pnpm-lock.yaml')
    // Regenerate from the maintained manifest and workspace policy. Reusing a
    // prior lock would preserve obsolete peer snapshots across toolchain or
    // upstream metadata changes and make a strict install report false errors.
    await runPnpm(validationDir, registry, false)
    const lock = readFileSync(validationLockPath, 'utf8')
    // Requests proxied through the temporary registry otherwise make pnpm
    // spell every ordinary npm resolution with a redundant explicit tarball
    // URL. Strip only that default-registry noise; integrity hashes remain.
    const normalizedLock = lock
      .replace(/, tarball: https:\/\/registry\.npmjs\.org\/[^\n]+\}/g, '}')
      .replace(/, tarball: http:\/\/127\.0\.0\.1:\d+\/[^\n]+\}/g, '}')
    const requiredCandidates = candidates.filter(
      ({ packageJson }) =>
        packageJson.name !== mcpCandidate.packageJson.name ||
        validationManifest.dependencies?.[packageJson.name] === packageJson.version ||
        validationManifest.devDependencies?.[packageJson.name] === packageJson.version,
    )
    for (const { integrity, packageJson } of requiredCandidates) {
      const packageKey = `${packageJson.name}@${packageJson.version}`
      const serializedPackageKey = packageKey.startsWith('@') ? `'${packageKey}'` : packageKey
      if (
        !normalizedLock.includes(`\n  ${serializedPackageKey}:\n`) ||
        !normalizedLock.includes(`resolution: {integrity: ${integrity}}`)
      ) {
        throw new Error(
          `${directory}/pnpm-lock.yaml did not adopt ${packageJson.name} candidate integrity`,
        )
      }
    }
    // The candidate manifests are part of the release contract. Preserve the
    // complete lock pnpm regenerated from those manifests; merging only the
    // module's own blocks would retain removed peers and stale importer specs.
    writeFileSync(validationLockPath, normalizedLock)
    await runPnpm(validationDir, registry, true)
    if (readFileSync(validationLockPath, 'utf8') !== normalizedLock) {
      throw new Error(`${directory}/pnpm-lock.yaml changed during frozen validation`)
    }
    updatedLocks.set(lockPath, normalizedLock)
  }
  for (const [lockPath, updatedLock] of updatedLocks) writeFileSync(lockPath, updatedLock)
  console.log(
    `\nUpdated ${maintainedCandidateApps.length} candidate app lockfiles from the exact Vue/Nuxt/MCP candidate set.`,
  )
} catch (error) {
  for (const [lockPath, originalLock] of originalLocks) {
    writeFileSync(lockPath, originalLock)
  }
  throw error
} finally {
  const closed = new Promise((resolvePromise) => server.close(resolvePromise))
  server.closeAllConnections()
  await closed
  rmSync(validationRoot, { recursive: true, force: true })
}
