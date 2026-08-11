#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

import { getPackageArtifactCoordinates } from './package-artifact-coordinates.mjs'
import {
  parsePackageArtifactEvidence,
  selectPackageArtifactRuntimeIdentity,
} from './package-artifact-evidence.mjs'
import {
  assertNoPrivateJwkMaterial,
  authAdapterComponentFunctions,
  spawnAuthRaceWorkers,
} from './run-auth-concurrency.mjs'
import { runExternalAuthorizationCodeRace } from './run-oauth-code-concurrency.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourceCloudFixture = join(root, 'starters', 'mcp-oauth-agent')
const reportPath = join(root, '.release-artifacts', 'bcn-auth-staging.report.json')
const convexCli = join(root, 'node_modules', 'convex', 'bin', 'main.js')
const COMPONENT_PATH = 'betterAuth'
const PROJECT = 'bcn-auth-staging'
const RUNTIME_FINGERPRINT = /^bcn-release-v1-[0-9a-f]{64}$/u
const INGRESS_LEASE = /^[\w-]{43,128}$/u
const DEPLOYMENT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u
const MODEL_NAME = /^[A-Za-z][A-Za-z0-9]*$/u
const MAX_COMMAND_OUTPUT = 1024 * 1024
const MAX_JWKS_BYTES = 64 * 1024
const MAX_FINGERPRINT_BYTES = 4 * 1024
const MAX_SIGNUP_BYTES = 64 * 1024
const MAX_REPORT_BYTES = 64 * 1024
const RUNTIME_FINGERPRINT_HEADER = 'x-bcn-runtime-fingerprint'
const INGRESS_COOKIE_NAME = '__Host-bcn-staging-lease'
const releaseProofFunctions = {
  cleanup: makeFunctionReference('releaseProof:cleanup'),
  inspect: makeFunctionReference('releaseProof:inspect'),
  sessionIdentity: makeFunctionReference('releaseProof:sessionIdentity'),
  setOAuthAdministrator: makeFunctionReference('mcpAdmin:setOAuthAdministratorByEmail'),
}
const adapterFindMany = makeFunctionReference('adapter:findMany')

function fail(code) {
  throw new Error(code)
}

function assert(condition, code) {
  if (!condition) fail(code)
}

function commandEnvironment(extra = {}) {
  const env = { CI: 'true', NO_COLOR: '1' }
  for (const name of ['HOME', 'PATH', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name]
  }
  return { ...env, ...extra }
}

function strictHttpsOrigin(value, code) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 2_048, code)
  let url
  try {
    url = new URL(value)
  } catch {
    fail(code)
  }
  assert(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      url.origin === value,
    code,
  )
  return url
}

function requiredEnvironment(env, name) {
  const value = env[name]
  assert(typeof value === 'string' && value.length > 0, `AUTH_CLOUD_STAGING_${name}_MISSING`)
  return value
}

export function parseCloudStagingEnvironment(env) {
  const adminKey = requiredEnvironment(env, 'CONVEX_DEPLOY_KEY')
  const keyMatch = /^prod:([^|]+)\|[^\s|]{32,}$/u.exec(adminKey)
  assert(keyMatch && DEPLOYMENT_NAME.test(keyMatch[1]), 'AUTH_CLOUD_STAGING_DEPLOY_KEY_INVALID')
  const deploymentName = keyMatch[1]
  const team = requiredEnvironment(env, 'BCN_AUTH_STAGING_TEAM')
  assert(DEPLOYMENT_NAME.test(team), 'AUTH_CLOUD_STAGING_TEAM_INVALID')

  const convexUrl = strictHttpsOrigin(
    requiredEnvironment(env, 'BCN_AUTH_STAGING_CONVEX_URL'),
    'AUTH_CLOUD_STAGING_CONVEX_URL_INVALID',
  )
  const convexSiteUrl = strictHttpsOrigin(
    requiredEnvironment(env, 'BCN_AUTH_STAGING_CONVEX_SITE_URL'),
    'AUTH_CLOUD_STAGING_CONVEX_SITE_URL_INVALID',
  )
  const origin = strictHttpsOrigin(
    requiredEnvironment(env, 'BCN_AUTH_STAGING_ORIGIN'),
    'AUTH_CLOUD_STAGING_ORIGIN_INVALID',
  )

  const cloudLabels = convexUrl.hostname.split('.')
  assert(
    cloudLabels.length >= 3 &&
      cloudLabels[0] === deploymentName &&
      cloudLabels.slice(-2).join('.') === 'convex.cloud',
    'AUTH_CLOUD_STAGING_CONVEX_URL_MISMATCH',
  )
  const expectedSiteHost = [...cloudLabels.slice(0, -2), 'convex', 'site'].join('.')
  assert(convexSiteUrl.hostname === expectedSiteHost, 'AUTH_CLOUD_STAGING_CONVEX_SITE_URL_MISMATCH')
  assert(
    origin.origin !== convexUrl.origin && origin.origin !== convexSiteUrl.origin,
    'AUTH_CLOUD_STAGING_ORIGIN_INVALID',
  )

  const email = requiredEnvironment(env, 'BCN_AUTH_STAGING_EMAIL')
  const password = requiredEnvironment(env, 'BCN_AUTH_STAGING_PASSWORD')
  const ingressLease = requiredEnvironment(env, 'BCN_AUTH_STAGING_INGRESS_LEASE')
  assert(
    email.length <= 320 &&
      ![...email].some((character) => {
        const code = character.codePointAt(0)
        return code !== undefined && (code <= 31 || code === 127)
      }),
    'AUTH_CLOUD_STAGING_EMAIL_INVALID',
  )
  assert(
    password.length >= 15 &&
      password.length <= 1_024 &&
      !password.includes('\0') &&
      !password.includes('\r') &&
      !password.includes('\n'),
    'AUTH_CLOUD_STAGING_PASSWORD_INVALID',
  )
  assert(INGRESS_LEASE.test(ingressLease), 'AUTH_CLOUD_STAGING_INGRESS_LEASE_INVALID')

  return Object.freeze({
    adminKey,
    convexSiteUrl: convexSiteUrl.origin,
    convexUrl: convexUrl.origin,
    deploymentName,
    email,
    ingressCookie: `${INGRESS_COOKIE_NAME}=${ingressLease}`,
    ingressLease,
    origin: origin.origin,
    password,
    team,
  })
}

function oneMatch(source, pattern, code) {
  const matches = [...source.matchAll(pattern)]
  assert(matches.length === 1, code)
  return matches[0]
}

export function parseConvexDeploymentDescription(source, expected) {
  assert(
    typeof source === 'string' && source.length <= MAX_COMMAND_OUTPUT,
    'AUTH_CLOUD_STAGING_DEPLOYMENT_DESCRIPTION_INVALID',
  )
  const url = oneMatch(
    source,
    /^\s*URL:\s*(\S+)\s*$/gmu,
    'AUTH_CLOUD_STAGING_DEPLOYMENT_URL_MISSING',
  )[1]
  const deployment = oneMatch(
    source,
    /^\s*Deployment:\s*([a-z0-9-]+)\s*\(([^)]+)\)\s*$/gmu,
    'AUTH_CLOUD_STAGING_DEPLOYMENT_NAME_MISSING',
  )
  const team = oneMatch(
    source,
    /^\s*Team:\s*([a-z0-9-]+)\s*$/gmu,
    'AUTH_CLOUD_STAGING_TEAM_MISSING',
  )[1]
  const project = oneMatch(
    source,
    /^\s*Project:\s*([a-z0-9-]+)\s*$/gmu,
    'AUTH_CLOUD_STAGING_PROJECT_MISSING',
  )[1]
  assert(url === expected.convexUrl, 'AUTH_CLOUD_STAGING_DEPLOYMENT_URL_MISMATCH')
  assert(
    deployment[1] === expected.deploymentName && deployment[2] === 'prod',
    'AUTH_CLOUD_STAGING_DEPLOYMENT_MISMATCH',
  )
  assert(team === expected.team, 'AUTH_CLOUD_STAGING_TEAM_MISMATCH')
  assert(project === PROJECT, 'AUTH_CLOUD_STAGING_PROJECT_MISMATCH')
  return Object.freeze({
    deploymentName: deployment[1],
    project,
    team,
    type: 'prod',
  })
}

function runConvexCli(args, adminKey, failureCode, cwd = root) {
  try {
    return execFileSync(process.execPath, ['--', convexCli, ...args], {
      cwd,
      encoding: 'utf8',
      env: commandEnvironment({ CONVEX_DEPLOY_KEY: adminKey }),
      maxBuffer: MAX_COMMAND_OUTPUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    fail(failureCode)
  }
}

function readCloudDeployment(config, cwd) {
  const description = runConvexCli(
    ['deployments'],
    config.adminKey,
    'AUTH_CLOUD_STAGING_DEPLOYMENT_LOOKUP_FAILED',
    cwd,
  )
  return parseConvexDeploymentDescription(description, config)
}

function readArtifactIdentity(artifactManifest, packageId) {
  const artifactCoordinates = getPackageArtifactCoordinates(packageId, {
    repositoryRoot: root,
  })
  const path = resolve(root, artifactManifest)
  try {
    execFileSync(process.execPath, ['scripts/release.mjs', 'verify', path], {
      cwd: root,
      env: commandEnvironment(),
      stdio: 'inherit',
    })
  } catch {
    fail('AUTH_CLOUD_STAGING_ARTIFACT_VERIFY_FAILED')
  }
  let evidence
  try {
    evidence = parsePackageArtifactEvidence(
      JSON.parse(readFileSync(path, 'utf8')),
      artifactCoordinates,
    )
  } catch {
    fail('AUTH_CLOUD_STAGING_ARTIFACT_MANIFEST_INVALID')
  }
  const tarballPath = resolve(dirname(path), evidence.tarball.file)
  assert(existsSync(tarballPath), 'AUTH_CLOUD_STAGING_ARTIFACT_TARBALL_MISSING')
  return Object.freeze({
    identity: selectPackageArtifactRuntimeIdentity(evidence),
    tarballPath,
  })
}

export function assertCloudArtifactFamily(artifacts) {
  const { mcp, nuxt, vue } = artifacts
  assert(
    nuxt?.identity?.package === 'better-convex-nuxt' &&
      vue?.identity?.package === 'better-convex-vue' &&
      mcp?.identity?.package === 'better-convex-mcp' &&
      nuxt.identity.version === vue.identity.version &&
      nuxt.identity.sourceCommit === vue.identity.sourceCommit &&
      nuxt.identity.sourceCommit === mcp.identity.sourceCommit &&
      RUNTIME_FINGERPRINT.test(nuxt.identity.runtimeFingerprint) &&
      vue.identity.runtimeFingerprint === null &&
      mcp.identity.runtimeFingerprint === null,
    'AUTH_CLOUD_STAGING_ARTIFACT_FAMILY_MISMATCH',
  )
  return artifacts
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function readBoundedResponse(response, maximumBytes, code) {
  const reader = response.body?.getReader()
  assert(reader, code)
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumBytes) {
      await reader.cancel().catch(() => {})
      fail(code)
    }
    chunks.push(Buffer.from(value))
  }
  assert(size > 0, code)
  return Buffer.concat(chunks, size).toString('utf8')
}

async function discardBoundedResponse(response, maximumBytes, code) {
  const reader = response.body?.getReader()
  if (!reader) return
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    size += value.byteLength
    if (size > maximumBytes) {
      await reader.cancel().catch(() => {})
      fail(code)
    }
  }
}

export function assertCloudRouteFingerprint(response, artifact, code) {
  assert(
    response instanceof Response &&
      response.headers.get(RUNTIME_FINGERPRINT_HEADER) === artifact.runtimeFingerprint,
    code,
  )
  return true
}

export function assertCloudRuntimeFingerprint(value, artifact) {
  assert(
    isRecord(value) &&
      Object.keys(value).sort().join(',') === 'runtimeFingerprint,schemaVersion' &&
      value.schemaVersion === 1 &&
      RUNTIME_FINGERPRINT.test(value.runtimeFingerprint) &&
      value.runtimeFingerprint === artifact.runtimeFingerprint,
    'AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_MISMATCH',
  )
  return true
}

async function fetchWithTimeout(url, init, failureCode) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    try {
      return await fetch(url, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      fail(failureCode)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function assertClosedPublicIngress(config) {
  const probes = [
    { method: 'GET', path: '/api/_better-convex-nuxt/release-fingerprint' },
    { method: 'GET', path: '/api/auth/get-session' },
    {
      body: '{}',
      headers: { 'content-type': 'application/json', origin: config.origin },
      method: 'POST',
      path: '/api/auth/sign-up/email',
    },
  ]
  for (const probe of probes) {
    const endpoint = `${config.origin}${probe.path}`
    const response = await fetchWithTimeout(
      endpoint,
      {
        body: probe.body,
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache', ...probe.headers },
        method: probe.method,
      },
      'AUTH_CLOUD_STAGING_CLOSED_INGRESS_FETCH_FAILED',
    )
    assert(
      response.status === 403 &&
        response.url === endpoint &&
        response.headers.get(RUNTIME_FINGERPRINT_HEADER) === null,
      'AUTH_CLOUD_STAGING_INGRESS_NOT_CLOSED',
    )
    await discardBoundedResponse(
      response,
      MAX_FINGERPRINT_BYTES,
      'AUTH_CLOUD_STAGING_INGRESS_INVALID',
    )
  }
}

async function fetchCloudRuntimeFingerprint(config, artifact) {
  const endpoint = `${config.origin}/api/_better-convex-nuxt/release-fingerprint`
  const response = await fetchWithTimeout(
    endpoint,
    {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        cookie: config.ingressCookie,
      },
      method: 'GET',
    },
    'AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_FETCH_FAILED',
  )
  assert(
    response.status === 200 &&
      response.url === endpoint &&
      /^application\/json(?:;|$)/iu.test(response.headers.get('content-type') ?? ''),
    'AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_RESPONSE_INVALID',
  )
  assertCloudRouteFingerprint(
    response,
    artifact,
    'AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_RESPONSE_INVALID',
  )
  let value
  try {
    value = JSON.parse(
      await readBoundedResponse(
        response,
        MAX_FINGERPRINT_BYTES,
        'AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_RESPONSE_INVALID',
      ),
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AUTH_CLOUD_STAGING_')) throw error
    fail('AUTH_CLOUD_STAGING_RUNTIME_FINGERPRINT_RESPONSE_INVALID')
  }
  assertCloudRuntimeFingerprint(value, artifact)
}

export function assertSingleBetterAuthMount(source) {
  assert(
    typeof source === 'string' && source.length > 0 && source.length <= MAX_COMMAND_OUTPUT,
    'AUTH_CLOUD_STAGING_COMPONENT_MOUNT_INVALID',
  )
  const uses = source.match(/\bapp\.use\s*\(/gu) ?? []
  const imports =
    source.match(
      /import\s+betterAuth\s+from\s+['"]better-convex-nuxt\/convex-auth\/convex\.config['"]/gu,
    ) ?? []
  const mounts =
    source.match(/app\.use\(\s*betterAuth\s*,\s*\{\s*name:\s*['"]betterAuth['"]\s*\}\s*\)/gu) ?? []
  assert(
    uses.length === 1 && imports.length === 1 && mounts.length === 1,
    'AUTH_CLOUD_STAGING_COMPONENT_MOUNT_INVALID',
  )
  return true
}

export function assertInstalledArtifactFingerprint(moduleSource, helperSource, artifact) {
  const bindings =
    typeof moduleSource === 'string'
      ? (moduleSource.match(
          /import\s*\{\s*getPackedRuntimeFingerprint\s*\}\s*from\s*['"]\.\.\/dist\/runtime\/shared\/release-fingerprint\.js['"]/gu,
        ) ?? [])
      : []
  assert(
    bindings.length === 1 &&
      typeof helperSource === 'string' &&
      helperSource.split(artifact.runtimeFingerprint).length === 2 &&
      !moduleSource.includes('__BCN_RELEASE_RUNTIME_FINGERPRINT__') &&
      !helperSource.includes('__BCN_RELEASE_RUNTIME_FINGERPRINT__'),
    'AUTH_CLOUD_STAGING_INSTALLED_ARTIFACT_MISMATCH',
  )
  return true
}

function runFixtureCommand(executable, args, cwd, failureCode, extraEnvironment = {}) {
  try {
    return execFileSync(executable, args, {
      cwd,
      encoding: 'utf8',
      env: commandEnvironment(extraEnvironment),
      maxBuffer: MAX_COMMAND_OUTPUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    fail(failureCode)
  }
}

function readStarterAppTables(fixtureDirectory) {
  const source = readFileSync(join(fixtureDirectory, 'convex', 'schema.ts'), 'utf8')
  const tables = [...source.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*defineTable\(/gmu)].map(
    (match) => match[1],
  )
  const allDefinitions = source.match(/\bdefineTable\(/gu) ?? []
  assert(
    tables.length > 0 &&
      tables.length <= 64 &&
      tables.length === allDefinitions.length &&
      new Set(tables).size === tables.length,
    'AUTH_CLOUD_STAGING_APP_TABLE_DISCOVERY_FAILED',
  )
  return tables
}

function generatedReleaseProofSource(runtimeFingerprint, authModels, appTables) {
  return `import { components } from './_generated/api'
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from './_generated/server'

const runtimeFingerprint = ${JSON.stringify(runtimeFingerprint)}
const componentMounts = ['betterAuth'] as const
const authModels = ${JSON.stringify(authModels)} as const
const appTables = ${JSON.stringify(appTables)} as const
const MAX_ROWS = 1_000

async function readState(ctx: QueryCtx | MutationCtx) {
  const authCounts: Record<string, number> = {}
  for (const model of authModels) {
    authCounts[model] = await ctx.runQuery(components.betterAuth.adapter.count, { model })
  }
  const appCounts: Record<string, number> = {}
  for (const table of appTables) {
    const rows = await ctx.db.query(table).take(MAX_ROWS + 1)
    if (rows.length > MAX_ROWS) throw new Error('RELEASE_PROOF_APP_ROW_BOUND_EXCEEDED')
    appCounts[table] = rows.length
  }
  return { appCounts, authCounts, componentMounts, runtimeFingerprint, schemaVersion: 1 }
}

export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => await readState(ctx),
})

export const sessionIdentity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const claims = identity as unknown as Record<string, unknown>
    return {
      subject: identity.subject,
      tokenUse: typeof claims.token_use === 'string' ? claims.token_use : null,
    }
  },
})

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const appDeleted: Record<string, number> = {}
    for (const table of appTables) {
      const rows = await ctx.db.query(table).take(MAX_ROWS + 1)
      if (rows.length > MAX_ROWS) throw new Error('RELEASE_PROOF_APP_ROW_BOUND_EXCEEDED')
      for (const row of rows) await ctx.db.delete(row._id)
      appDeleted[table] = rows.length
    }

    const authDeleted: Record<string, number> = {}
    for (const model of authModels) {
      const count = await ctx.runQuery(components.betterAuth.adapter.count, { model })
      if (!Number.isSafeInteger(count) || count < 0 || count > MAX_ROWS) {
        throw new Error('RELEASE_PROOF_AUTH_ROW_BOUND_EXCEEDED')
      }
      const deleted = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        model,
        where: [],
      })
      if (deleted !== count) throw new Error('RELEASE_PROOF_AUTH_CLEANUP_MISMATCH')
      authDeleted[model] = deleted
    }
    return { appDeleted, authDeleted }
  },
})
`
}

export function bindCloudFixtureArtifacts(fixturePackage, artifacts) {
  const nextPackage = structuredClone(fixturePackage)
  for (const packageId of ['mcp', 'nuxt', 'vue']) {
    const artifact = artifacts[packageId]
    nextPackage.dependencies[artifact.identity.package] = `file:${artifact.tarballPath}`
  }
  const vue = artifacts.vue
  const workspace = `packages:\n  - .\n\noverrides:\n  better-convex-vue@${vue.identity.version}: file:${vue.tarballPath}\n`
  return Object.freeze({ package: nextPackage, workspace })
}

async function prepareCloudFixture(artifacts) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'bcn-auth-cloud-'))
  const fixtureDirectory = join(temporaryRoot, 'mcp-oauth-agent')
  try {
    cpSync(sourceCloudFixture, fixtureDirectory, {
      recursive: true,
      filter: (source) => {
        const relative = source
          .slice(sourceCloudFixture.length)
          .replaceAll('\\', '/')
          .replace(/^\//u, '')
        if (!relative) return true
        const rootEntry = relative.split('/')[0]
        return (
          !['.convex', '.nuxt', '.output', 'node_modules'].includes(rootEntry) &&
          relative !== 'pnpm-lock.yaml' &&
          !/(?:^|\/)\.env(?:\.|$)/u.test(relative)
        )
      },
    })

    assertSingleBetterAuthMount(
      readFileSync(join(fixtureDirectory, 'convex', 'convex.config.ts'), 'utf8'),
    )
    const packagePath = join(fixtureDirectory, 'package.json')
    const fixturePackage = JSON.parse(readFileSync(packagePath, 'utf8'))
    const boundFixture = bindCloudFixtureArtifacts(fixturePackage, artifacts)
    writeFileSync(packagePath, `${JSON.stringify(boundFixture.package, null, 2)}\n`)
    writeFileSync(join(fixtureDirectory, 'pnpm-workspace.yaml'), boundFixture.workspace)
    runFixtureCommand(
      'pnpm',
      ['install', '--no-frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies'],
      fixtureDirectory,
      'AUTH_CLOUD_STAGING_FIXTURE_INSTALL_FAILED',
    )

    const installedRoot = join(fixtureDirectory, 'node_modules', 'better-convex-nuxt')
    const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
    const nuxtArtifact = artifacts.nuxt
    assert(
      installedPackage.name === nuxtArtifact.identity.package &&
        installedPackage.version === nuxtArtifact.identity.version,
      'AUTH_CLOUD_STAGING_INSTALLED_ARTIFACT_MISMATCH',
    )
    assertInstalledArtifactFingerprint(
      readFileSync(join(installedRoot, 'dist', 'module.mjs'), 'utf8'),
      readFileSync(
        join(installedRoot, 'dist', 'runtime', 'shared', 'release-fingerprint.js'),
        'utf8',
      ),
      nuxtArtifact.identity,
    )

    const metadataPath = join(
      installedRoot,
      'dist',
      'runtime',
      'convex-auth',
      'component',
      'schemaMetadata.js',
    )
    const metadata = (await import(`${pathToFileURL(metadataPath).href}?release-proof`)).default
    assert(
      isRecord(metadata) && isRecord(metadata.models),
      'AUTH_CLOUD_STAGING_AUTH_MODEL_DISCOVERY_FAILED',
    )
    const authModels = Object.entries(metadata.models)
      .map(([name, model]) => {
        assert(
          MODEL_NAME.test(name) && isRecord(model) && model.logicalName === name,
          'AUTH_CLOUD_STAGING_AUTH_MODEL_DISCOVERY_FAILED',
        )
        return name
      })
      .sort()
    assert(
      authModels.length > 0 && authModels.length <= 64,
      'AUTH_CLOUD_STAGING_AUTH_MODEL_DISCOVERY_FAILED',
    )
    const appTables = readStarterAppTables(fixtureDirectory)
    writeFileSync(
      join(fixtureDirectory, 'convex', 'releaseProof.ts'),
      generatedReleaseProofSource(nuxtArtifact.identity.runtimeFingerprint, authModels, appTables),
    )
    return Object.freeze({
      appTables,
      authModels,
      directory: fixtureDirectory,
      temporaryRoot,
    })
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true })
    throw error
  }
}

function deployCloudFixture(config, fixture, artifact) {
  runConvexCli(
    [
      'deploy',
      '--typecheck',
      'enable',
      '--typecheck-components',
      '--codegen',
      'enable',
      '--message',
      `BCN release gate ${artifact.runtimeFingerprint}`,
    ],
    config.adminKey,
    'AUTH_CLOUD_STAGING_FIXTURE_DEPLOY_FAILED',
    fixture.directory,
  )
}

function normalizeEmptyCountMap(value, expectedNames, code) {
  assert(
    isRecord(value) &&
      Object.keys(value).sort().join(',') === [...expectedNames].sort().join(',') &&
      Object.values(value).every((count) => Number.isSafeInteger(count) && count === 0),
    code,
  )
  return value
}

function normalizeCloudEmptyProof(value, expected, code) {
  assert(
    isRecord(value) &&
      Object.keys(value).sort().join(',') ===
        'appCounts,authCounts,componentMounts,runtimeFingerprint,schemaVersion' &&
      value.schemaVersion === 1 &&
      value.runtimeFingerprint === expected.runtimeFingerprint &&
      Array.isArray(value.componentMounts) &&
      value.componentMounts.length === 1 &&
      value.componentMounts[0] === COMPONENT_PATH,
    code,
  )
  normalizeEmptyCountMap(value.authCounts, expected.authModels, code)
  normalizeEmptyCountMap(value.appCounts, expected.appTables, code)
  return true
}

export function normalizeCloudPrewriteProof(value, expected) {
  return normalizeCloudEmptyProof(value, expected, 'AUTH_CLOUD_STAGING_PREWRITE_STATE_NOT_EMPTY')
}

function extractSessionCookie(response) {
  const getSetCookie = response.headers.getSetCookie
  assert(typeof getSetCookie === 'function', 'AUTH_CLOUD_STAGING_SESSION_COOKIE_MISSING')
  const values = getSetCookie.call(response.headers)
  assert(
    Array.isArray(values) && values.length > 0 && values.length <= 16,
    'AUTH_CLOUD_STAGING_SESSION_COOKIE_MISSING',
  )
  const sessionCookies = values
    .map((value) => value.split(';', 1)[0])
    .filter((value) => /(?:^|\.)session_token=/.test(value))
  assert(
    sessionCookies.length === 1 &&
      sessionCookies[0].length <= 8_192 &&
      /^[\w!#$%&'*+.^`|~-]+=[\x21-\x3A\x3C-\x7E]+$/u.test(sessionCookies[0]),
    'AUTH_CLOUD_STAGING_SESSION_COOKIE_MISSING',
  )
  return sessionCookies[0]
}

async function postAuthJson(config, artifact, path, body, code) {
  const endpoint = `${config.origin}/api/auth${path}`
  const response = await fetchWithTimeout(
    endpoint,
    {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers: {
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        cookie: config.ingressCookie,
        origin: config.origin,
      },
      method: 'POST',
    },
    code,
  )
  assert(response.url === endpoint, code)
  assertCloudRouteFingerprint(response, artifact, code)
  return response
}

async function bootstrapCloudOwner(config, client, artifact) {
  const signUp = await postAuthJson(
    config,
    artifact,
    '/sign-up/email',
    {
      email: config.email,
      name: 'BCN release gate',
      password: config.password,
    },
    'AUTH_CLOUD_STAGING_OWNER_BOOTSTRAP_FAILED',
  )
  assert(signUp.status === 200, 'AUTH_CLOUD_STAGING_OWNER_BOOTSTRAP_FAILED')
  await readBoundedResponse(signUp, MAX_SIGNUP_BYTES, 'AUTH_CLOUD_STAGING_OWNER_BOOTSTRAP_FAILED')

  const signIn = await postAuthJson(
    config,
    artifact,
    '/sign-in/email',
    { email: config.email, password: config.password },
    'AUTH_CLOUD_STAGING_OWNER_SIGN_IN_FAILED',
  )
  assert(signIn.status === 200, 'AUTH_CLOUD_STAGING_OWNER_SIGN_IN_FAILED')
  const sessionCookie = extractSessionCookie(signIn)
  await readBoundedResponse(signIn, MAX_SIGNUP_BYTES, 'AUTH_CLOUD_STAGING_OWNER_SIGN_IN_FAILED')
  await client.mutation(releaseProofFunctions.setOAuthAdministrator, {
    email: config.email,
    enabled: true,
  })
  return `${config.ingressCookie}; ${sessionCookie}`
}

function parseCanonicalJwtPart(value, code) {
  assert(/^[\w-]+$/u.test(value) && value.length <= 16 * 1024, code)
  const bytes = Buffer.from(value, 'base64url')
  assert(bytes.length > 0 && bytes.toString('base64url') === value, code)
  try {
    const parsed = JSON.parse(bytes.toString('utf8'))
    assert(isRecord(parsed), code)
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error
    fail(code)
  }
}

export function verifyCloudSessionToken(token, jwks, config) {
  const code = 'AUTH_CLOUD_STAGING_SESSION_JWT_INVALID'
  assert(typeof token === 'string' && token.length > 0 && token.length <= 64 * 1024, code)
  const parts = token.split('.')
  assert(parts.length === 3, code)
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = parseCanonicalJwtPart(encodedHeader, code)
  const claims = parseCanonicalJwtPart(encodedPayload, code)
  assert(
    Object.keys(header).sort().join(',') === 'alg,kid' &&
      header.alg === 'RS256' &&
      typeof header.kid === 'string' &&
      header.kid.length > 0 &&
      header.kid.length <= 512,
    code,
  )
  assert(
    Object.keys(claims).sort().join(',') === 'aud,exp,iat,iss,sid,sub,token_use' &&
      claims.aud === 'convex' &&
      claims.iss === config.convexSiteUrl &&
      claims.token_use === 'convex-session' &&
      typeof claims.sid === 'string' &&
      claims.sid.length > 0 &&
      claims.sid.length <= 512 &&
      typeof claims.sub === 'string' &&
      claims.sub.length > 0 &&
      claims.sub.length <= 512 &&
      Number.isSafeInteger(claims.iat) &&
      Number.isSafeInteger(claims.exp) &&
      claims.exp > claims.iat &&
      claims.exp - claims.iat <= 15 * 60 &&
      claims.iat <= Math.floor(Date.now() / 1_000) + 60 &&
      claims.exp > Math.floor(Date.now() / 1_000),
    code,
  )
  assert(isRecord(jwks) && Array.isArray(jwks.keys), code)
  const matches = jwks.keys.filter((key) => isRecord(key) && key.kid === header.kid)
  assert(matches.length === 1, code)
  const key = matches[0]
  assert(
    key.kty === 'RSA' && key.alg === 'RS256' && (key.use === undefined || key.use === 'sig'),
    code,
  )
  let publicKey
  try {
    publicKey = createPublicKey({ format: 'jwk', key })
  } catch {
    fail(code)
  }
  const signature = Buffer.from(encodedSignature, 'base64url')
  assert(
    signature.length > 0 &&
      signature.length <= 1_024 &&
      signature.toString('base64url') === encodedSignature &&
      verifySignature(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
        publicKey,
        signature,
      ),
    code,
  )
  return Object.freeze({
    claims,
    evidence: Object.freeze({
      algorithm: 'RS256',
      audience: 'convex',
      issuerMatched: true,
      lifetimeSeconds: claims.exp - claims.iat,
      signatureVerified: true,
      tokenUse: 'convex-session',
    }),
  })
}

async function componentFunction(client, reference, args) {
  return client.function(reference, COMPONENT_PATH, args)
}

function onlyExpectedFailures(results, expected) {
  return results.filter((result) => !result.ok).every((result) => result.error === expected)
}

async function fetchPublicJwks(config, artifact) {
  const endpoint = `${config.origin}/api/auth/jwks`
  const response = await fetchWithTimeout(
    endpoint,
    {
      cache: 'no-store',
      headers: {
        'cache-control': 'no-cache',
        origin: config.origin,
      },
      method: 'GET',
    },
    'AUTH_CLOUD_STAGING_JWKS_FETCH_FAILED',
  )
  assert(
    response.status === 200 && response.url === endpoint,
    'AUTH_CLOUD_STAGING_JWKS_FETCH_FAILED',
  )
  assertCloudRouteFingerprint(response, artifact, 'AUTH_CLOUD_STAGING_JWKS_FETCH_FAILED')
  let value
  try {
    value = JSON.parse(
      await readBoundedResponse(response, MAX_JWKS_BYTES, 'AUTH_CLOUD_STAGING_JWKS_SIZE_INVALID'),
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AUTH_CLOUD_STAGING_')) throw error
    fail('AUTH_CLOUD_STAGING_JWKS_RESPONSE_INVALID')
  }
  assert(value && Array.isArray(value.keys), 'AUTH_CLOUD_STAGING_JWKS_RESPONSE_INVALID')
  assertNoPrivateJwkMaterial(value)
  return value
}

async function verifyCloudSessionJwt(config, authCookie, artifact) {
  const endpoint = `${config.origin}/api/auth/convex/token`
  const response = await fetchWithTimeout(
    endpoint,
    {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        cookie: authCookie,
        origin: config.origin,
      },
      method: 'GET',
    },
    'AUTH_CLOUD_STAGING_SESSION_TOKEN_EXCHANGE_FAILED',
  )
  assert(
    response.status === 200 &&
      response.url === endpoint &&
      response.headers.get('cache-control') === 'private, no-store',
    'AUTH_CLOUD_STAGING_SESSION_TOKEN_EXCHANGE_FAILED',
  )
  assertCloudRouteFingerprint(
    response,
    artifact,
    'AUTH_CLOUD_STAGING_SESSION_TOKEN_EXCHANGE_FAILED',
  )
  let value
  try {
    value = JSON.parse(
      await readBoundedResponse(
        response,
        MAX_SIGNUP_BYTES,
        'AUTH_CLOUD_STAGING_SESSION_TOKEN_EXCHANGE_FAILED',
      ),
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AUTH_CLOUD_STAGING_')) throw error
    fail('AUTH_CLOUD_STAGING_SESSION_TOKEN_EXCHANGE_FAILED')
  }
  assert(
    isRecord(value) && Object.keys(value).join(',') === 'token' && typeof value.token === 'string',
    'AUTH_CLOUD_STAGING_SESSION_TOKEN_EXCHANGE_FAILED',
  )
  const jwks = await fetchPublicJwks(config, artifact)
  const verified = verifyCloudSessionToken(value.token, jwks, config)
  const client = new ConvexHttpClient(config.convexUrl)
  client.setAuth(value.token)
  let identity
  try {
    identity = await client.query(releaseProofFunctions.sessionIdentity, {})
  } catch {
    fail('AUTH_CLOUD_STAGING_SESSION_JWT_CONVEX_REJECTED')
  }
  assert(
    isRecord(identity) &&
      Object.keys(identity).sort().join(',') === 'subject,tokenUse' &&
      identity.subject === verified.claims.sub &&
      identity.tokenUse === 'convex-session',
    'AUTH_CLOUD_STAGING_SESSION_JWT_CONVEX_REJECTED',
  )
  return Object.freeze({
    ...verified.evidence,
    acceptedByConvex: true,
    subjectMatched: true,
  })
}

async function verifyCloudMcpRoute(config) {
  const endpoint = `${config.convexSiteUrl}/mcp`
  const response = await fetchWithTimeout(
    endpoint,
    {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {},
      }),
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        origin: config.origin,
      },
      method: 'POST',
    },
    'AUTH_CLOUD_STAGING_MCP_ROUTE_FAILED',
  )
  assert(
    response.status === 401 && response.url === endpoint,
    'AUTH_CLOUD_STAGING_MCP_ROUTE_FAILED',
  )
  assert(
    response.headers.get('www-authenticate') ===
      `Bearer resource_metadata="${config.convexSiteUrl}/.well-known/oauth-protected-resource/mcp"`,
    'AUTH_CLOUD_STAGING_MCP_ROUTE_FAILED',
  )
  await readBoundedResponse(response, MAX_SIGNUP_BYTES, 'AUTH_CLOUD_STAGING_MCP_ROUTE_FAILED')
  return true
}

async function readPublicRateLimitRows(client) {
  const result = await componentFunction(client, adapterFindMany, {
    model: 'rateLimit',
    paginationOpts: { cursor: null, numItems: 100 },
    select: ['key', 'count', 'lastRequest'],
    where: [],
  })
  assert(
    isRecord(result) &&
      result.isDone === true &&
      Array.isArray(result.page) &&
      result.page.length <= 100,
    'AUTH_CLOUD_STAGING_RATE_LIMIT_STORAGE_INVALID',
  )
  return result.page
}

async function provePublicAuthRateLimit(config, artifact, client) {
  let blocked
  let attempts = 0
  for (; attempts < 4; attempts += 1) {
    const response = await postAuthJson(
      config,
      artifact,
      '/sign-in/email',
      {
        email: `rate-limit-${randomBytes(8).toString('hex')}@example.test`,
        password: config.password,
      },
      'AUTH_CLOUD_STAGING_RATE_LIMIT_REQUEST_FAILED',
    )
    if (response.status === 429) {
      blocked = response
      break
    }
    assert(
      response.status === 400 || response.status === 401,
      'AUTH_CLOUD_STAGING_RATE_LIMIT_REQUEST_FAILED',
    )
    await readBoundedResponse(
      response,
      MAX_SIGNUP_BYTES,
      'AUTH_CLOUD_STAGING_RATE_LIMIT_REQUEST_FAILED',
    )
  }
  assert(blocked, 'AUTH_CLOUD_STAGING_RATE_LIMIT_NOT_ENFORCED')
  const retryAfter = Number(blocked.headers.get('x-retry-after'))
  assert(
    Number.isSafeInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 10,
    'AUTH_CLOUD_STAGING_RATE_LIMIT_RETRY_INVALID',
  )
  await readBoundedResponse(
    blocked,
    MAX_SIGNUP_BYTES,
    'AUTH_CLOUD_STAGING_RATE_LIMIT_RETRY_INVALID',
  )
  const blockedRows = await readPublicRateLimitRows(client)
  const persistedBlocked = blockedRows.filter(
    (row) =>
      isRecord(row) &&
      typeof row.key === 'string' &&
      row.key.endsWith('|/sign-in/email') &&
      row.count === 3 &&
      Number.isSafeInteger(row.lastRequest),
  )
  assert(persistedBlocked.length >= 1, 'AUTH_CLOUD_STAGING_RATE_LIMIT_STORAGE_INVALID')
  const persistedKey = persistedBlocked.reduce((latest, row) =>
    row.lastRequest > latest.lastRequest ? row : latest,
  ).key
  await new Promise((resolvePromise) => setTimeout(resolvePromise, retryAfter * 1_000 + 250))
  const reset = await postAuthJson(
    config,
    artifact,
    '/sign-in/email',
    {
      email: `rate-limit-reset-${randomBytes(8).toString('hex')}@example.test`,
      password: config.password,
    },
    'AUTH_CLOUD_STAGING_RATE_LIMIT_RESET_FAILED',
  )
  assert(reset.status === 400 || reset.status === 401, 'AUTH_CLOUD_STAGING_RATE_LIMIT_RESET_FAILED')
  await readBoundedResponse(reset, MAX_SIGNUP_BYTES, 'AUTH_CLOUD_STAGING_RATE_LIMIT_RESET_FAILED')
  const resetRows = await readPublicRateLimitRows(client)
  const persistedReset = resetRows.find(
    (row) => isRecord(row) && row.key === persistedKey && row.count === 1,
  )
  assert(persistedReset, 'AUTH_CLOUD_STAGING_RATE_LIMIT_STORAGE_INVALID')
  return Object.freeze({
    blocked: true,
    persisted: true,
    requestsUntilBlocked: attempts + 1,
    reset: true,
  })
}

async function runCloudRaces(config, artifact) {
  const client = new ConvexHttpClient(config.convexUrl)
  client.setAdminAuth(config.adminKey)
  const suffix = randomBytes(16).toString('hex')
  const rows = {
    increment: {
      id: `bcn-cloud-increment-${suffix}`,
      key: `bcn-cloud-increment-${suffix}`,
    },
    sameId: {
      id: `bcn-cloud-same-id-${suffix}`,
      key: `bcn-cloud-same-id-${suffix}`,
    },
  }
  const remove = (id) =>
    componentFunction(client, authAdapterComponentFunctions.remove, {
      model: 'rateLimit',
      where: [{ field: 'id', value: id }],
    })
  const find = (id) =>
    componentFunction(client, authAdapterComponentFunctions.findOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: id }],
    })
  const clearRows = async () => {
    try {
      await Promise.all(Object.values(rows).map((row) => remove(row.id)))
      const remaining = await Promise.all(Object.values(rows).map((row) => find(row.id)))
      assert(
        remaining.every((row) => row == null),
        'AUTH_CLOUD_STAGING_RACE_ROW_CLEANUP_FAILED',
      )
    } catch {
      fail('AUTH_CLOUD_STAGING_RACE_ROW_CLEANUP_FAILED')
    }
  }

  await clearRows()
  try {
    const sameId = await spawnAuthRaceWorkers(
      config.convexUrl,
      config.adminKey,
      'componentCreateSameId',
      rows.sameId.id,
      rows.sameId.key,
      16,
      1,
      COMPONENT_PATH,
    )
    const sameIdWinners = sameId.filter((result) => result.ok).length
    assert(sameIdWinners === 1, 'AUTH_CLOUD_STAGING_SAME_ID_WINNER_COUNT')
    assert(
      onlyExpectedFailures(sameId, 'AUTH_LOGICAL_ID_CONFLICT'),
      'AUTH_CLOUD_STAGING_SAME_ID_UNEXPECTED_FAILURE',
    )

    await componentFunction(client, authAdapterComponentFunctions.create, {
      data: { ...rows.increment, count: 0, lastRequest: 0 },
      model: 'rateLimit',
    })
    const incremented = await spawnAuthRaceWorkers(
      config.convexUrl,
      config.adminKey,
      'componentIncrement',
      rows.increment.id,
      rows.increment.key,
      16,
      4,
      COMPONENT_PATH,
    )
    assert(
      incremented.every((result) => result.ok),
      'AUTH_CLOUD_STAGING_INCREMENT_FAILURE',
    )
    const finalRow = await componentFunction(client, authAdapterComponentFunctions.findOne, {
      model: 'rateLimit',
      where: [{ field: 'id', value: rows.increment.id }],
    })
    assert(finalRow?.count === incremented.length, 'AUTH_CLOUD_STAGING_INCREMENT_LOST_UPDATE')

    const rotations = await spawnAuthRaceWorkers(
      config.convexUrl,
      config.adminKey,
      'operatorRotate',
      '',
      '',
      8,
    )
    assert(
      rotations.every((result) => result.ok),
      'AUTH_CLOUD_STAGING_JWKS_ROTATION_FAILURE',
    )
    rotations.forEach((result) => assertNoPrivateJwkMaterial(result.value))
    const jwks = await fetchPublicJwks(config, artifact)
    const publishedKids = new Set(jwks.keys.map((key) => key?.kid))
    for (const result of rotations) {
      assert(
        typeof result.value?.newKid === 'string' && publishedKids.has(result.value.newKid),
        'AUTH_CLOUD_STAGING_JWKS_KEY_NOT_PUBLISHED',
      )
    }

    return Object.freeze({
      increment: Object.freeze({
        attempts: incremented.length,
        expectedCount: incremented.length,
        observedCount: finalRow.count,
      }),
      jwksRotation: Object.freeze({
        attempts: rotations.length,
        published: rotations.length,
        succeeded: rotations.length,
      }),
      sameId: Object.freeze({
        attempts: sameId.length,
        rejected: sameId.length - sameIdWinners,
        winners: sameIdWinners,
      }),
    })
  } finally {
    await clearRows()
  }
}

export function parseCloudArtifactArguments(argv) {
  if (
    argv.length !== 6 ||
    argv[0] !== '--artifact-manifest' ||
    !argv[1] ||
    argv[2] !== '--vue-artifact-manifest' ||
    !argv[3] ||
    argv[4] !== '--mcp-artifact-manifest' ||
    !argv[5]
  ) {
    fail(
      'Usage: node scripts/run-auth-cloud-staging.mjs --artifact-manifest <nuxt-artifact.json> --vue-artifact-manifest <vue-artifact.json> --mcp-artifact-manifest <mcp-artifact.json>',
    )
  }
  return Object.freeze({
    mcpArtifactManifest: argv[5],
    nuxtArtifactManifest: argv[1],
    vueArtifactManifest: argv[3],
  })
}

function containsCompactJwt(value) {
  if (typeof value === 'string') return /[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/u.test(value)
  if (Array.isArray(value)) return value.some(containsCompactJwt)
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some(containsCompactJwt)
}

export function normalizeAuthorizationCodeEvidence(value) {
  assert(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === 'attempts,rejected,replayRejected,winners' &&
      value.attempts === 2 &&
      value.rejected === 1 &&
      value.replayRejected === true &&
      value.winners === 1,
    'AUTH_CLOUD_STAGING_AUTHORIZATION_CODE_EVIDENCE_INVALID',
  )
  return Object.freeze({
    attempts: value.attempts,
    rejected: value.rejected,
    replayRejected: value.replayRejected,
    winners: value.winners,
  })
}

function writeReport(report, secrets) {
  assertNoPrivateJwkMaterial(report)
  const output = `${JSON.stringify(report, null, 2)}\n`
  assert(Buffer.byteLength(output) <= MAX_REPORT_BYTES, 'AUTH_CLOUD_STAGING_REPORT_SIZE_INVALID')
  for (const secret of secrets) {
    assert(!output.includes(secret), 'AUTH_CLOUD_STAGING_REPORT_SECRET_LEAK')
  }
  assert(!containsCompactJwt(report), 'AUTH_CLOUD_STAGING_REPORT_TOKEN_LEAK')
  mkdirSync(dirname(reportPath), { recursive: true, mode: 0o700 })
  writeFileSync(reportPath, output, { mode: 0o600 })
  chmodSync(reportPath, 0o600)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  rmSync(reportPath, { force: true })
  const startedAt = new Date().toISOString()
  const { mcpArtifactManifest, nuxtArtifactManifest, vueArtifactManifest } =
    parseCloudArtifactArguments(argv)
  const config = parseCloudStagingEnvironment(env)
  const artifacts = assertCloudArtifactFamily({
    mcp: readArtifactIdentity(mcpArtifactManifest, 'mcp'),
    nuxt: readArtifactIdentity(nuxtArtifactManifest, 'nuxt'),
    vue: readArtifactIdentity(vueArtifactManifest, 'vue'),
  })
  const artifact = artifacts.nuxt
  let fixture
  let cleanupRequired = false
  let deployment
  let criticalRaces
  let authorizationCode
  let rateLimit
  let sessionJwt
  try {
    // A provider-specific host deployment happens before protected-environment
    // approval. A stale or source-built host cannot pass this package-owned URL.
    await assertClosedPublicIngress(config)
    await fetchCloudRuntimeFingerprint(config, artifact.identity)
    fixture = await prepareCloudFixture(artifacts)
    deployment = readCloudDeployment(config, fixture.directory)
    deployCloudFixture(config, fixture, artifact.identity)

    const client = new ConvexHttpClient(config.convexUrl)
    client.setAdminAuth(config.adminKey)
    const expectedProof = {
      appTables: fixture.appTables,
      authModels: fixture.authModels,
      runtimeFingerprint: artifact.identity.runtimeFingerprint,
    }
    let prewriteProof
    try {
      prewriteProof = await client.query(releaseProofFunctions.inspect, {})
    } catch {
      fail('AUTH_CLOUD_STAGING_PREWRITE_PROOF_FAILED')
    }
    normalizeCloudPrewriteProof(prewriteProof, expectedProof)

    // Only an environment proven empty becomes owned by this run. From here
    // every partial bootstrap or race is paired with exhaustive cleanup below.
    cleanupRequired = true
    await verifyCloudMcpRoute(config)
    const authCookie = await bootstrapCloudOwner(config, client, artifact.identity)
    sessionJwt = await verifyCloudSessionJwt(config, authCookie, artifact.identity)
    criticalRaces = await runCloudRaces(config, artifact.identity)
    authorizationCode = normalizeAuthorizationCodeEvidence(
      await runExternalAuthorizationCodeRace({
        email: config.email,
        ingressLease: config.ingressLease,
        origin: config.origin,
        password: config.password,
      }),
    )
    rateLimit = await provePublicAuthRateLimit(config, artifact.identity, client)
  } finally {
    try {
      if (cleanupRequired && fixture) {
        try {
          const client = new ConvexHttpClient(config.convexUrl)
          client.setAdminAuth(config.adminKey)
          await client.mutation(releaseProofFunctions.cleanup, {})
          const postCleanupProof = await client.query(releaseProofFunctions.inspect, {})
          normalizeCloudEmptyProof(
            postCleanupProof,
            {
              appTables: fixture.appTables,
              authModels: fixture.authModels,
              runtimeFingerprint: artifact.identity.runtimeFingerprint,
            },
            'AUTH_CLOUD_STAGING_POST_CLEANUP_STATE_NOT_EMPTY',
          )
        } catch {
          fail('AUTH_CLOUD_STAGING_POST_CLEANUP_FAILED')
        }
      }
    } finally {
      if (fixture) rmSync(fixture.temporaryRoot, { force: true, recursive: true })
    }
  }

  assert(
    deployment && criticalRaces && authorizationCode && rateLimit && sessionJwt,
    'AUTH_CLOUD_STAGING_RESULT_INCOMPLETE',
  )
  const report = {
    schemaVersion: 3,
    kind: 'bcn-auth-staging-critical-races',
    result: 'passed',
    startedAt,
    completedAt: new Date().toISOString(),
    artifact: artifact.identity,
    artifactProof: {
      authProxyFingerprintMatched: true,
      deployedFixtureFingerprintMatched: true,
      installedFromManifestTarball: true,
      mcpResourceChallengeVerified: true,
      publicOriginFingerprintMatched: true,
    },
    deployment: {
      convexSiteUrl: config.convexSiteUrl,
      convexUrl: config.convexUrl,
      deploymentName: deployment.deploymentName,
      project: deployment.project,
      publicOrigin: config.origin,
      team: deployment.team,
      type: deployment.type,
    },
    state: {
      closedIngressProved: true,
      postCleanupEmpty: true,
      prewriteEmpty: true,
      singleBetterAuthMount: true,
    },
    identity: { sessionJwt },
    races: {
      authorizationCode,
      increment: criticalRaces.increment,
      jwksRotation: criticalRaces.jwksRotation,
      rateLimit,
      sameId: criticalRaces.sameId,
    },
  }
  writeReport(report, [config.adminKey, config.email, config.ingressLease, config.password])
  console.log(`[auth-cloud-staging] PASS: ${reportPath}`)
  return report
}

function safeError(error, secrets) {
  let text = error instanceof Error ? error.message : String(error)
  for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, '[REDACTED]')
  return text.replace(/[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/gu, '[REDACTED]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      safeError(error, [
        process.env.CONVEX_DEPLOY_KEY,
        process.env.BCN_AUTH_STAGING_EMAIL,
        process.env.BCN_AUTH_STAGING_INGRESS_LEASE,
        process.env.BCN_AUTH_STAGING_PASSWORD,
      ]),
    )
    process.exitCode = 1
  })
}
