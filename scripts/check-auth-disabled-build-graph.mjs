#!/usr/bin/env node
// Builds test/fixtures/auth-disabled (a real default-off Nuxt app) and scans
// the generated client + Nitro output for markers unique to the auth-enabled-
// only files: the Better Auth client plugin, the auth engine, the auth proxy
// server handler, and the `convex-auth` route middleware. An auth-disabled
// production build must contain none of them in its client or Nitro graphs.
//
// Modeled on test/fixtures/missing-convex-api's approach of a real, minimal
// fixture app plus a deterministic scan rather than a synthetic unit double.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const fixtureDir = join(repoRoot, 'test/fixtures/auth-disabled')
const outputDir = join(fixtureDir, '.output')
const buildDir = join(fixtureDir, '.nuxt')

// Markers that may ONLY legitimately appear if the auth-enabled-only files
// (plugin.auth.client.ts, plugin.server.ts, the auth proxy handler, or the
// `convex-auth` route middleware) were bundled. No auth composable, page-meta
// augmentation, or rendering component exists in this fixture's public API.
const FORBIDDEN_MARKERS = [
  'better-auth',
  'createAuthClient',
  'createConvexAuthEngine',
  'buildAuthProxyUnreachableMessage',
  'buildAuthProxyUpstreamStatusMessage',
  'buildBlockedOriginMessage',
  'buildMissingSiteUrlMessage',
  'resolveRouteProtectionDecision',
]

function collectFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    // Skip vendored/hoisted dependency trees entirely: only the app's own
    // client and Nitro OUTPUT chunks are relevant to this scan, and Nitro's
    // `node_modules/.nitro` traced-dependency tree can contain deep symlink
    // cycles (unrelated to this module's build graph).
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue // broken/cyclic symlink; not a build-graph output file
    }
    if (stats.isDirectory()) out.push(...collectFiles(full))
    else if (/\.(?:m?js|json)$/.test(entry)) out.push(full)
  }
  return out
}

function scan(dir, label) {
  const violations = []
  for (const file of collectFiles(dir)) {
    const contents = readFileSync(file, 'utf8')
    for (const marker of FORBIDDEN_MARKERS) {
      if (contents.includes(marker)) {
        violations.push(`${label}: ${file} contains forbidden marker "${marker}"`)
      }
    }
  }
  return violations
}

function scanGeneratedPublicSurface() {
  const violations = []
  const generatedContracts = [
    ['imports', join(buildDir, 'imports.d.ts')],
    ['typed imports', join(buildDir, 'types', 'imports.d.ts')],
    ['components', join(buildDir, 'components.d.ts')],
  ]
  const forbiddenNames = [
    'useConvexAuth',
    'ConvexAuthenticated',
    'ConvexUnauthenticated',
    'ConvexAuthLoading',
    'ConvexAuthError',
    'convexAuth?:',
  ]

  for (const [label, file] of generatedContracts) {
    if (!existsSync(file)) continue
    const contents = readFileSync(file, 'utf8')
    for (const name of forbiddenNames) {
      if (contents.includes(name)) {
        violations.push(`${label}: ${file} exposes auth-only name "${name}"`)
      }
    }
  }
  const authPageMeta = join(buildDir, 'types', 'better-convex-nuxt-auth.d.ts')
  if (existsSync(authPageMeta)) {
    violations.push(`page meta: no-auth build generated ${authPageMeta}`)
  }
  const generatedTsConfig = join(buildDir, 'tsconfig.json')
  if (
    existsSync(generatedTsConfig) &&
    readFileSync(generatedTsConfig, 'utf8').includes('#convex/auth-client')
  ) {
    violations.push(`types: no-auth build registered the #convex/auth-client virtual module`)
  }
  return violations
}

function main() {
  rmSync(outputDir, { recursive: true, force: true })
  rmSync(join(fixtureDir, '.nuxt'), { recursive: true, force: true })

  console.log('[check-auth-disabled-build-graph] building fixture (auth omitted)...')
  execFileSync('pnpm', ['exec', 'nuxi', 'build', '--cwd', fixtureDir], {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  const violations = [
    ...scan(join(outputDir, 'public'), 'client graph'),
    ...scan(join(outputDir, 'server'), 'nitro graph'),
    ...scanGeneratedPublicSurface(),
  ]

  if (violations.length > 0) {
    console.error('[check-auth-disabled-build-graph] FAILED:')
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exit(1)
  }

  console.log(
    '[check-auth-disabled-build-graph] OK — no Better Auth client, auth engine, proxy handler, or auth middleware markers found in the auth-disabled build graph.',
  )
}

main()
