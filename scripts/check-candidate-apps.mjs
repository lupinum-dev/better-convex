#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { getMaintainedCandidateProfile } from './maintained-candidate-apps.mjs'
import { canonicalNpmTarballFilename } from './package-artifact-coordinates.mjs'
import { getPackageCertificationDescriptor } from './package-certification-manifest.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const agencyConvexDeployKey = process.env.AGENCY_CONVEX_DEPLOY_KEY
const inheritedEnvironment = Object.fromEntries(
  [
    'COREPACK_HOME',
    'GIT_INDEX_FILE',
    'HOME',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'LANG',
    'LC_ALL',
    'NODE_EXTRA_CA_CERTS',
    'NO_PROXY',
    'PATH',
    'PNPM_HOME',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
)
const deterministicEnvironment = {
  ...inheritedEnvironment,
  BCN_AUTH_PROXY_IP_SECRET: 'candidate-artifact-proxy-ip-secret-32-characters',
  BETTER_AUTH_SECRETS: '1:candidate-artifact-verification-secret-32-characters',
  CI: 'true',
  CONVEX_SITE_URL: 'https://candidate-artifact.convex.site',
  CONVEX_URL: 'https://candidate-artifact.convex.cloud',
  NUXT_PUBLIC_CONVEX_SITE_URL: 'https://candidate-artifact.convex.site',
  NUXT_PUBLIC_CONVEX_URL: 'https://candidate-artifact.convex.cloud',
  NUXT_TELEMETRY_DISABLED: '1',
  SITE_URL: 'http://127.0.0.1:3000',
  TZ: 'UTC',
  VITE_CONVEX_SITE_URL: 'https://candidate-artifact.convex.site',
  VITE_CONVEX_URL: 'https://candidate-artifact.convex.cloud',
}

const options = parseArguments(process.argv.slice(2))
const { descriptor: packageDescriptor, profile: candidateProfile } = getMaintainedCandidateProfile(
  options.packageId,
)
const suppliedTarball = options.tarball ? resolve(repoRoot, options.tarball) : undefined
if (options.vueTarball && !candidateProfile.companionPackages?.includes('vue')) {
  throw new Error('--vue-tarball is valid only for a reviewed profile with the Vue companion')
}
if (options.mcpTarball && options.packageId !== 'nuxt') {
  throw new Error('--mcp-tarball is valid only for the reviewed Nuxt consumer profile')
}

function parseArguments(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!['--package', '--tarball', '--vue-tarball', '--mcp-tarball'].includes(argument)) {
      throw new Error(`Unknown candidate-app argument: ${String(argument)}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`)
    if (values.has(argument)) throw new Error(`Duplicate ${argument} argument.`)
    values.set(argument, value)
    index += 1
  }
  if (!values.has('--package')) {
    throw new Error(
      'Usage: check-candidate-apps.mjs --package <reviewed-id> [--tarball <path>] [--vue-tarball <path>] [--mcp-tarball <path>]',
    )
  }
  return {
    packageId: values.get('--package'),
    tarball: values.get('--tarball'),
    vueTarball: values.get('--vue-tarball'),
    mcpTarball: values.get('--mcp-tarball'),
  }
}

function run(command, commandArgs, options = {}) {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`)
  return execFileSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? deterministicEnvironment,
    stdio: options.capture ? 'pipe' : 'inherit',
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function replaceExactlyOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor)
  if (first === -1 || source.includes(anchor, first + anchor.length)) {
    throw new Error(`mcp-oauth-agent: expected one ${label} codegen anchor`)
  }
  return source.replace(anchor, replacement)
}

function addMcpConsumerExtensionProbe(appDir) {
  writeFileSync(
    join(appDir, 'convex', 'consumerExtension.ts'),
    `import { v } from 'convex/values'

import { query } from './_generated/server'

export const echo = query({
  args: { value: v.string() },
  returns: v.string(),
  handler: (_ctx, { value }) => value,
})
`,
  )

  const apiPath = join(appDir, 'convex', '_generated', 'api.d.ts')
  let apiSource = readFileSync(apiPath, 'utf8')
  const authImport = 'import type * as auth from "../auth.js";'
  apiSource = replaceExactlyOnce(
    apiSource,
    authImport,
    `${authImport}\nimport type * as consumerExtension from "../consumerExtension.js";`,
    'module import',
  )
  const authMap = '  auth: typeof auth;'
  apiSource = replaceExactlyOnce(
    apiSource,
    authMap,
    `${authMap}\n  consumerExtension: typeof consumerExtension;`,
    'module map',
  )
  writeFileSync(apiPath, apiSource)
  console.log('mcp-oauth-agent: added one offline generated-API consumer-extension type probe')
}

function sha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64')
}

function packageFingerprint(directory) {
  const files = []

  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      if (name === 'node_modules') continue
      const path = join(current, name)
      const stats = lstatSync(path)
      if (stats.isDirectory()) {
        walk(path)
      } else if (stats.isFile()) {
        files.push({
          path: relative(directory, path).split('\\').join('/'),
          sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
        })
      } else {
        throw new Error(`Unexpected non-file package entry: ${path}`)
      }
    }
  }

  walk(directory)
  return files
}

function prepareCompanionCandidates(mainManifest) {
  return candidateProfile.companionPackages.map((packageId) => {
    const descriptor = getPackageCertificationDescriptor(packageId)
    const packageRoot = resolve(repoRoot, descriptor.packageDirectory)
    const suppliedCompanion = packageId === 'vue' ? options.vueTarball : undefined
    let tarballPath
    let filename
    if (suppliedCompanion) {
      tarballPath = resolve(repoRoot, suppliedCompanion)
      const stats = existsSync(tarballPath) ? lstatSync(tarballPath) : undefined
      if (!stats?.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Supplied ${packageId} companion must be a regular tarball`)
      }
      filename = tarballPath.split(/[\\/]/u).at(-1)
    } else {
      run('pnpm', ['run', 'prepack'], { cwd: packageRoot })
      const packResult = JSON.parse(
        run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchDir], {
          cwd: packageRoot,
          capture: true,
        }),
      )
      if (!Array.isArray(packResult) || packResult.length !== 1 || !packResult[0]?.filename) {
        throw new Error(`Companion package ${packageId} must produce exactly one tarball`)
      }
      filename = packResult[0].filename
      tarballPath = join(scratchDir, filename)
    }
    const extractedDir = join(scratchDir, `companion-${descriptor.id}`)
    mkdirSync(extractedDir)
    run('tar', ['-xzf', tarballPath, '-C', extractedDir])
    const packageDir = join(extractedDir, 'package')
    const manifest = readJson(join(packageDir, 'package.json'))
    if (manifest.name !== descriptor.packageName) {
      throw new Error(`Companion package ${packageId} has unexpected packed identity`)
    }
    const expectedFilename = canonicalNpmTarballFilename(descriptor.packageName, manifest.version)
    if (filename !== expectedFilename) {
      throw new Error(`Companion package ${packageId} has unexpected tarball filename`)
    }
    if (mainManifest.dependencies?.[descriptor.packageName] !== manifest.version) {
      throw new Error(
        `${packageDescriptor.packageName} must depend on exact ${descriptor.packageName}@${manifest.version}`,
      )
    }
    return {
      descriptor,
      filename,
      fingerprint: packageFingerprint(packageDir),
      integrity: sha512(tarballPath),
      manifest,
      tarballPath,
    }
  })
}

function prepareFixtureCompanionCandidate(packageId, suppliedTarball, sourceManifest, label) {
  if (packageId !== 'mcp') throw new Error(`${label}: unsupported fixture companion ${packageId}`)
  const descriptor = getPackageCertificationDescriptor(packageId)
  const packageRoot = resolve(repoRoot, descriptor.packageDirectory)
  let tarballPath
  let filename
  if (suppliedTarball) {
    tarballPath = resolve(repoRoot, suppliedTarball)
    filename = tarballPath.split(/[\\/]/u).at(-1)
  } else {
    run('pnpm', ['run', 'prepack'], { cwd: packageRoot })
    const packResult = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchDir], {
        cwd: packageRoot,
        capture: true,
      }),
    )
    if (!Array.isArray(packResult) || packResult.length !== 1 || !packResult[0]?.filename) {
      throw new Error(`${label}: MCP companion must produce exactly one tarball`)
    }
    filename = packResult[0].filename
    tarballPath = join(scratchDir, filename)
  }
  const stats = existsSync(tarballPath) ? lstatSync(tarballPath) : undefined
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label}: MCP companion must be a regular tarball`)
  }
  const extractedDir = join(scratchDir, `companion-${descriptor.id}-${label}`)
  mkdirSync(extractedDir)
  run('tar', ['-xzf', tarballPath, '-C', extractedDir])
  const packageDir = join(extractedDir, 'package')
  const manifest = readJson(join(packageDir, 'package.json'))
  if (
    manifest.name !== descriptor.packageName ||
    filename !== canonicalNpmTarballFilename(descriptor.packageName, manifest.version) ||
    dependencySpecifier(sourceManifest, descriptor.packageName) !== manifest.version
  ) {
    throw new Error(`${label}: supplied MCP companion identity does not match the fixture`)
  }
  return {
    descriptor,
    filename,
    fingerprint: packageFingerprint(packageDir),
    integrity: sha512(tarballPath),
    manifest,
    tarballPath,
  }
}

function addCompanionCandidates(appDir, manifest, companions, label) {
  for (const companion of companions) {
    const localTarball = join(appDir, companion.filename)
    copyFileSync(companion.tarballPath, localTarball)
    if (sha512(localTarball) !== companion.integrity) {
      throw new Error(`${label}: copied ${companion.descriptor.packageName} tarball differs`)
    }
    const packageName = companion.descriptor.packageName
    if (manifest.dependencies?.[packageName]) {
      manifest.dependencies[packageName] = `file:./${companion.filename}`
    } else if (manifest.devDependencies?.[packageName]) {
      manifest.devDependencies[packageName] = `file:./${companion.filename}`
    } else {
      manifest.devDependencies ??= {}
      manifest.devDependencies[packageName] = `file:./${companion.filename}`
    }
  }
}

function addPnpmCompanionOverrides(appDir, companions) {
  if (companions.length === 0) return
  const workspacePath = join(appDir, 'pnpm-workspace.yaml')
  const current = existsSync(workspacePath) ? readFileSync(workspacePath, 'utf8') : ''
  for (const companion of companions) {
    if (current.includes(`${companion.descriptor.packageName}:`)) {
      throw new Error(
        `Candidate fixture already controls ${companion.descriptor.packageName} resolution`,
      )
    }
  }
  const rules = companions
    .map((companion) => `  '${companion.descriptor.packageName}': 'file:./${companion.filename}'`)
    .join('\n')
  const overrideHeader = /^overrides:\s*$/mu
  const next = overrideHeader.test(current)
    ? current.replace(overrideHeader, (header) => `${header}\n${rules}`)
    : `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}overrides:\n${rules}\n`
  writeFileSync(workspacePath, next)
}

function verifyInstalledCompanions(appDir, lock, companions, label) {
  for (const companion of companions) {
    if (!lock.includes(companion.filename)) {
      throw new Error(`${label}: lock does not resolve ${companion.filename}`)
    }
    const installedDir = join(appDir, 'node_modules', companion.descriptor.packageName)
    const installedManifest = readJson(join(installedDir, 'package.json'))
    if (installedManifest.version !== companion.manifest.version) {
      throw new Error(
        `${label}: installed ${companion.descriptor.packageName}@${installedManifest.version}; expected ${companion.manifest.version}`,
      )
    }
    if (
      JSON.stringify(packageFingerprint(installedDir)) !== JSON.stringify(companion.fingerprint)
    ) {
      throw new Error(`${label}: installed ${companion.descriptor.packageName} bytes differ`)
    }
  }
}

function dependencySpecifier(packageJson, name) {
  return (
    packageJson.dependencies?.[name] ??
    packageJson.devDependencies?.[name] ??
    packageJson.peerDependencies?.[name]
  )
}

function copyApp(app, destinationDir) {
  const untracked = run(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z', '--', app.path],
    { capture: true },
  )
    .split('\0')
    .filter(Boolean)
  if (untracked.length > 0) {
    throw new Error(`${app.path} has untracked release inputs: ${untracked.join(', ')}`)
  }

  const tracked = run('git', ['ls-files', '--cached', '-z', '--', app.path], {
    capture: true,
  })
    .split('\0')
    .filter(Boolean)
  if (tracked.length === 0) throw new Error(`${app.path} has no Git-tracked files`)

  for (const repositoryPath of tracked) {
    const sourcePath = join(repoRoot, repositoryPath)
    if (!existsSync(sourcePath)) continue
    const destinationPath = join(destinationDir, relative(app.path, repositoryPath))
    mkdirSync(dirname(destinationPath), { recursive: true })
    cpSync(sourcePath, destinationPath, { recursive: true })
  }

  copyFileSync(join(repoRoot, 'LICENSE'), join(destinationDir, 'LICENSE'))
}

function assertNoRepositoryOverride(app) {
  const workspacePath = join(repoRoot, app.path, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) return
  const workspace = readFileSync(workspacePath, 'utf8')
  const escapedName = packageDescriptor.packageName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  if (new RegExp(`${escapedName}\\s*:\\s*(?:file|link|workspace):`, 'u').test(workspace)) {
    throw new Error(
      `${app.path}/pnpm-workspace.yaml must not override ${packageDescriptor.packageName} to the repository`,
    )
  }
}

function compareGeneratedTree(sourceDir, candidateDir) {
  const source = packageFingerprint(sourceDir)
  const candidate = packageFingerprint(candidateDir)
  if (JSON.stringify(source) !== JSON.stringify(candidate)) {
    throw new Error(
      'Agency Convex codegen changed convex/_generated; regenerate and commit the live output',
    )
  }
}

function verifyNpmConsumer(
  tarballPath,
  candidateManifest,
  expectedFingerprint,
  integrity,
  companions,
) {
  const fixture = candidateProfile.npmConsumer
  const appDir = join(scratchDir, 'apps', fixture.name)
  copyApp(fixture, appDir)
  const localTarball = join(appDir, candidateProfile.tarballFilename)
  copyFileSync(tarballPath, localTarball)
  if (sha512(localTarball) !== integrity) {
    throw new Error('npm consumer: copied candidate tarball differs from the release artifact')
  }

  const manifestPath = join(appDir, 'package.json')
  const manifest = readJson(manifestPath)
  manifest.devDependencies = {
    ...manifest.devDependencies,
    [packageDescriptor.packageName]: `file:./${candidateProfile.tarballFilename}`,
  }
  addCompanionCandidates(appDir, manifest, companions, 'npm consumer')
  writeJson(manifestPath, manifest)

  console.log(
    `\n=== ${fixture.path} with npm against ${candidateManifest.name}@${candidateManifest.version} ===`,
  )
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: appDir,
  })

  const lock = readFileSync(join(appDir, 'package-lock.json'), 'utf8')
  if (!lock.includes(candidateProfile.tarballFilename)) {
    throw new Error('npm consumer: package-lock does not resolve the candidate tarball')
  }
  verifyInstalledCompanions(appDir, lock, companions, 'npm consumer')
  const installedPackageDir = join(appDir, 'node_modules', packageDescriptor.packageName)
  const installedManifest = readJson(join(installedPackageDir, 'package.json'))
  if (installedManifest.version !== candidateManifest.version) {
    throw new Error(
      `npm consumer: installed ${installedManifest.version}; expected ${candidateManifest.version}`,
    )
  }
  if (
    JSON.stringify(packageFingerprint(installedPackageDir)) !== JSON.stringify(expectedFingerprint)
  ) {
    throw new Error('npm consumer: installed package bytes differ from the candidate tarball')
  }

  run('npm', ['run', 'typecheck'], { cwd: appDir })
  run('npm', ['run', 'build'], {
    cwd: appDir,
    env: { ...deterministicEnvironment, NODE_ENV: 'production' },
  })
}

function productionPublicFiles(publicDirectory) {
  if (!existsSync(publicDirectory)) {
    throw new Error('mcp-oauth-agent: production build omitted .output/public')
  }
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(relative(publicDirectory, path).split('\\').join('/'))
      else throw new Error(`mcp-oauth-agent: unexpected public build entry ${path}`)
    }
  }
  visit(publicDirectory)
  return files
}

async function availableProductionPort() {
  const server = createServer()
  await new Promise((ready, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', ready)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('mcp-oauth-agent: could not allocate a production probe port')
  }
  await new Promise((ready, reject) => server.close((error) => (error ? reject(error) : ready())))
  return address.port
}

async function stopProductionServer(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    new Promise((ready) => child.once('exit', () => ready(true))),
    new Promise((ready) => setTimeout(() => ready(false), 2_000)),
  ])
  if (!stopped) {
    child.kill('SIGKILL')
    if (child.exitCode === null) {
      await new Promise((ready) => child.once('exit', ready))
    }
  }
}

async function responseStatus(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  await response.body?.cancel().catch(() => {})
  return response.status
}

async function waitForProductionAsset(child, url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('mcp-oauth-agent: production server exited before source-map probe')
    }
    try {
      if ((await responseStatus(url)) === 200) return
    } catch {
      // The bounded readiness loop retries connection refusal while Nitro starts.
    }
    await new Promise((ready) => setTimeout(ready, 100))
  }
  throw new Error('mcp-oauth-agent: production asset did not become reachable')
}

async function assertProductionSourceMapsArePrivate(appDir) {
  const outputDirectory = join(appDir, '.output')
  const publicDirectory = join(outputDirectory, 'public')
  const publicFiles = productionPublicFiles(publicDirectory)
  const publicMaps = publicFiles.filter((file) => file.endsWith('.map'))
  if (publicMaps.length > 0) {
    throw new Error(
      `mcp-oauth-agent: production public output contains source maps: ${publicMaps.join(', ')}`,
    )
  }

  const publicCode = publicFiles.filter((file) => /\.(?:css|js|mjs)$/u.test(file))
  for (const file of publicCode) {
    if (/sourceMappingURL\s*=\s*data:/u.test(readFileSync(join(publicDirectory, file), 'utf8'))) {
      throw new Error(`mcp-oauth-agent: production public output embeds a source map in ${file}`)
    }
  }

  const asset = publicFiles.find((file) => file.startsWith('_nuxt/') && file.endsWith('.js'))
  if (!asset) throw new Error('mcp-oauth-agent: production build omitted a public JavaScript asset')
  const serverEntry = join(outputDirectory, 'server', 'index.mjs')
  if (!existsSync(serverEntry)) {
    throw new Error('mcp-oauth-agent: production build omitted .output/server/index.mjs')
  }

  const port = await availableProductionPort()
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [serverEntry], {
    cwd: appDir,
    env: {
      ...deterministicEnvironment,
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(port),
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: 'ignore',
  })
  try {
    await waitForProductionAsset(child, `${origin}/${asset}`)
    const probes = [`/${asset}.map`, '/index.mjs.map']
    const statuses = []
    for (const path of probes) {
      const status = await responseStatus(`${origin}${path}`)
      if (status === 200) {
        throw new Error(`mcp-oauth-agent: production server publicly served ${path}`)
      }
      statuses.push(`${path}=${status}`)
    }
    console.log(
      `[candidate-source-maps] PASS: mcp-oauth-agent production public output has no map files or inline maps; ${statuses.join(', ')}.`,
    )
  } finally {
    await stopProductionServer(child)
  }
}

const scratchDir = mkdtempSync(join(tmpdir(), 'bcn-candidate-apps-'))

try {
  let tarballPath = suppliedTarball
  if (!tarballPath) {
    const packageRoot = resolve(repoRoot, packageDescriptor.packageDirectory)
    run('pnpm', ['run', 'prepack'], { cwd: packageRoot })
    const packResult = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchDir], {
        cwd: packageRoot,
        capture: true,
      }),
    )
    tarballPath = join(scratchDir, packResult[0].filename)
  }

  if (!existsSync(tarballPath)) {
    throw new Error(`Candidate tarball does not exist: ${tarballPath}`)
  }

  if (candidateProfile.kind === 'runners') {
    run(process.execPath, [
      'scripts/check-package-exports.mjs',
      '--package',
      packageDescriptor.id,
      '--tarball',
      tarballPath,
    ])
    for (const runner of candidateProfile.runners) {
      run(process.execPath, [runner, '--tarball', tarballPath])
    }
    console.log(
      `\nCandidate runner matrix passed (${candidateProfile.runners.length} maintained consumers, one exact tarball).`,
    )
  } else {
    const extractedDir = join(scratchDir, 'extracted')
    mkdirSync(extractedDir)
    run('tar', ['-xzf', tarballPath, '-C', extractedDir])
    const extractedPackageDir = join(extractedDir, 'package')
    const candidateManifest = readJson(join(extractedPackageDir, 'package.json'))
    if (candidateManifest.name !== packageDescriptor.packageName) {
      throw new Error(
        `Candidate package is ${String(candidateManifest.name)}; expected ${packageDescriptor.packageName}`,
      )
    }
    const expectedFingerprint = packageFingerprint(extractedPackageDir)
    const tarballIntegrity = sha512(tarballPath)
    const companionCandidates = prepareCompanionCandidates(candidateManifest)

    for (const app of candidateProfile.pnpmApps) {
      assertNoRepositoryOverride(app)
      const sourceDir = join(repoRoot, app.path)
      const sourceManifest = readJson(join(sourceDir, 'package.json'))
      const sourceVersion = dependencySpecifier(sourceManifest, packageDescriptor.packageName)
      if (sourceVersion !== candidateManifest.version) {
        throw new Error(
          `${app.path}/package.json declares ${packageDescriptor.packageName}@${sourceVersion ?? '<missing>'}; expected ${candidateManifest.version}`,
        )
      }
      const sourceLockPath = join(sourceDir, 'pnpm-lock.yaml')
      if (!existsSync(sourceLockPath)) {
        throw new Error(`${app.path}/pnpm-lock.yaml is missing`)
      }
      const appDir = join(scratchDir, 'apps', app.name)
      copyApp(app, appDir)
      const localTarball = join(appDir, candidateProfile.tarballFilename)
      copyFileSync(tarballPath, localTarball)
      if (sha512(localTarball) !== tarballIntegrity) {
        throw new Error(`${app.path}: copied candidate tarball differs from the release artifact`)
      }

      const manifestPath = join(appDir, 'package.json')
      const manifest = readJson(manifestPath)
      if (manifest.dependencies?.[packageDescriptor.packageName]) {
        manifest.dependencies[packageDescriptor.packageName] =
          `file:./${candidateProfile.tarballFilename}`
      } else if (manifest.devDependencies?.[packageDescriptor.packageName]) {
        manifest.devDependencies[packageDescriptor.packageName] =
          `file:./${candidateProfile.tarballFilename}`
      } else {
        throw new Error(
          `${app.path}/package.json does not declare ${packageDescriptor.packageName}`,
        )
      }
      const fixtureCompanions = (app.companionPackages ?? []).map((packageId) =>
        prepareFixtureCompanionCandidate(
          packageId,
          packageId === 'mcp' ? options.mcpTarball : undefined,
          sourceManifest,
          app.name,
        ),
      )
      const appCompanions = [...companionCandidates, ...fixtureCompanions]
      addCompanionCandidates(appDir, manifest, appCompanions, app.path)
      writeJson(manifestPath, manifest)
      addPnpmCompanionOverrides(appDir, appCompanions)

      console.log(
        `\n=== ${app.path} against ${candidateManifest.name}@${candidateManifest.version} ===`,
      )
      // Preserve every committed transitive resolution. Only replace the module
      // package entry with the exact local tarball, then prove that resulting
      // candidate lock is internally frozen-installable.
      run(
        'pnpm',
        [
          'install',
          '--lockfile-only',
          '--no-frozen-lockfile',
          '--ignore-scripts',
          '--strict-peer-dependencies',
        ],
        {
          cwd: appDir,
        },
      )
      run(
        'pnpm',
        ['install', '--frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies'],
        {
          cwd: appDir,
        },
      )

      const lock = readFileSync(join(appDir, 'pnpm-lock.yaml'), 'utf8')
      if (!lock.includes(candidateProfile.tarballFilename)) {
        throw new Error(`${app.path}: the fresh lock does not resolve the candidate tarball`)
      }
      verifyInstalledCompanions(appDir, lock, appCompanions, app.path)

      const installedPackageDir = join(appDir, 'node_modules', packageDescriptor.packageName)
      const installedManifest = readJson(join(installedPackageDir, 'package.json'))
      if (installedManifest.version !== candidateManifest.version) {
        throw new Error(
          `${app.path}: installed ${installedManifest.version}; expected ${candidateManifest.version}`,
        )
      }
      const installedFingerprint = packageFingerprint(installedPackageDir)
      if (JSON.stringify(installedFingerprint) !== JSON.stringify(expectedFingerprint)) {
        throw new Error(`${app.path}: installed package bytes differ from the candidate tarball`)
      }

      if (app.name === 'agency' && agencyConvexDeployKey) {
        const codegenAuthorityPath = join(appDir, '.env.local')
        writeFileSync(
          codegenAuthorityPath,
          `CONVEX_DEPLOY_KEY=${JSON.stringify(agencyConvexDeployKey)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        )
        try {
          run('pnpm', ['run', 'convex:codegen'], {
            cwd: appDir,
            env: deterministicEnvironment,
          })
        } finally {
          rmSync(codegenAuthorityPath, { force: true })
        }
        compareGeneratedTree(
          join(sourceDir, 'convex', '_generated'),
          join(appDir, 'convex', '_generated'),
        )
      }

      if (app.name === 'mcp-oauth-agent') addMcpConsumerExtensionProbe(appDir)

      run('pnpm', ['run', 'typecheck'], { cwd: appDir })
      if (manifest.scripts?.test) run('pnpm', ['run', 'test'], { cwd: appDir })
      run('pnpm', ['run', 'build'], {
        cwd: appDir,
        env: { ...deterministicEnvironment, NODE_ENV: 'production' },
      })
      if (app.name === 'mcp-oauth-agent') await assertProductionSourceMapsArePrivate(appDir)
    }

    verifyNpmConsumer(
      tarballPath,
      candidateManifest,
      expectedFingerprint,
      tarballIntegrity,
      companionCandidates,
    )

    const vueCandidate = companionCandidates.find((candidate) => candidate.descriptor.id === 'vue')
    if (!vueCandidate) throw new Error('Nuxt candidate profile requires one Vue companion')
    for (const runner of candidateProfile.browserRunners) {
      run(process.execPath, [
        runner,
        '--nuxt-tarball',
        tarballPath,
        '--vue-tarball',
        vueCandidate.tarballPath,
      ])
    }

    if (!agencyConvexDeployKey) {
      console.log(
        '\nAgency live codegen freshness skipped: set AGENCY_CONVEX_DEPLOY_KEY to enable it.',
      )
    }
    console.log(
      `\nCandidate app matrix passed (${candidateProfile.pnpmApps.length} pnpm apps, one npm consumer, and ${candidateProfile.browserRunners.length} production browser runner; one exact package set).`,
    )
  }
} finally {
  rmSync(scratchDir, { recursive: true, force: true })
}
