#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  assertCloudArtifactFamily,
  assertClosedPublicIngress,
  fetchCloudRuntimeFingerprint,
  parseCloudArtifactArguments,
  parseCloudStagingAuthorityEnvironment,
  readArtifactIdentity,
} from './run-auth-cloud-staging.mjs'

const root = resolve(import.meta.dirname, '..')
const sourceFixture = join(root, 'starters', 'mcp-oauth-agent')
const MAX_VERCEL_OUTPUT = 1024 * 1024
const VERCEL_ID = /^[\w-]{3,128}$/u

function requiredEnvironment(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`AUTH_STAGING_HOST_${name}_MISSING`)
  }
  return value
}

function copyFixture(destination) {
  cpSync(sourceFixture, destination, {
    recursive: true,
    filter: (source) => {
      const relative = source.slice(sourceFixture.length).replaceAll('\\', '/').replace(/^\//u, '')
      if (!relative) return true
      const rootEntry = relative.split('/')[0]
      return (
        !['.convex', '.nuxt', '.output', '.vercel', 'node_modules'].includes(rootEntry) &&
        relative !== 'pnpm-lock.yaml' &&
        !/(?:^|\/)\.env(?:\.|$)/u.test(relative)
      )
    },
  })
}

function bindFixture(destination, artifacts) {
  const vendor = join(destination, 'vendor')
  mkdirSync(vendor)
  const manifestPath = join(destination, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const packageId of ['mcp', 'nuxt', 'vue']) {
    const artifact = artifacts[packageId]
    const filename = basename(artifact.tarballPath)
    cpSync(artifact.tarballPath, join(vendor, filename))
    manifest.dependencies[artifact.identity.package] = `file:./vendor/${filename}`
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(destination, 'pnpm-workspace.yaml'),
    `packages:\n  - .\n\noverrides:\n  better-convex-vue@${artifacts.vue.identity.version}: file:./vendor/${basename(artifacts.vue.tarballPath)}\n`,
  )
}

async function waitForExactHost(config, artifact) {
  let lastError
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await assertClosedPublicIngress(config)
      await fetchCloudRuntimeFingerprint(config, artifact)
      return
    } catch (error) {
      lastError = error
      if (attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
    }
  }
  throw lastError
}

export async function deployAuthStagingHost(argv = process.argv.slice(2), env = process.env) {
  const { mcpArtifactManifest, nuxtArtifactManifest, vueArtifactManifest } =
    parseCloudArtifactArguments(argv)
  const config = parseCloudStagingAuthorityEnvironment(env)
  const artifacts = assertCloudArtifactFamily({
    mcp: readArtifactIdentity(mcpArtifactManifest, 'mcp'),
    nuxt: readArtifactIdentity(nuxtArtifactManifest, 'nuxt'),
    vue: readArtifactIdentity(vueArtifactManifest, 'vue'),
  })
  const orgId = requiredEnvironment(env, 'BCN_AUTH_STAGING_VERCEL_ORG_ID')
  const projectId = requiredEnvironment(env, 'BCN_AUTH_STAGING_VERCEL_PROJECT_ID')
  const token = requiredEnvironment(env, 'BCN_AUTH_STAGING_VERCEL_TOKEN')
  if (!VERCEL_ID.test(orgId) || !VERCEL_ID.test(projectId) || token.length > 2048) {
    throw new Error('AUTH_STAGING_HOST_VERCEL_AUTHORITY_INVALID')
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'bcn-auth-staging-host-'))
  const fixture = join(temporaryRoot, 'host')
  try {
    copyFixture(fixture)
    bindFixture(fixture, artifacts)
    execFileSync('vercel', ['deploy', '--prod', '--yes'], {
      cwd: fixture,
      env: {
        ...process.env,
        VERCEL_ORG_ID: orgId,
        VERCEL_PROJECT_ID: projectId,
        VERCEL_TOKEN: token,
      },
      maxBuffer: MAX_VERCEL_OUTPUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForExactHost(config, artifacts.nuxt.identity)
    console.log(
      `[auth-staging-host] PASS: ${config.origin} serves ${artifacts.nuxt.identity.runtimeFingerprint}`,
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AUTH_')) throw error
    throw new Error('AUTH_STAGING_HOST_DEPLOYMENT_FAILED', { cause: error })
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  deployAuthStagingHost().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
