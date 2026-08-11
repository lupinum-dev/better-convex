#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const fixturePackageLink = join(
  root,
  'test/fixtures/better-auth-two-factor/node_modules/better-convex-nuxt',
)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('node', ['scripts/check-auth-backend.mjs'])
run('pnpm', ['exec', 'jiti', 'scripts/generate-auth-schema.mjs', '--check'])
run('pnpm', ['exec', 'nuxt-module-build', 'prepare'])
run('pnpm', ['run', 'check:better-auth-two-factor'])
run('pnpm', [
  'exec',
  'vitest',
  'run',
  '--project=security',
  'test/security/convex-auth-two-factor-fixture.test.ts',
])
run('pnpm', ['exec', 'vitest', 'run', '--project=convex', 'test/convex/auth-adapter-query.test.ts'])
run('pnpm', ['exec', 'nuxt-module-build', 'build'])

const env = {
  ...process.env,
  BCN_E2E_REQUIRE_LOCAL: 'true',
  CONVEX_AGENT_MODE: 'anonymous',
  CONVEX_E2E_AUTO_START: 'true',
}
for (const name of [
  'CONVEX_DEPLOYMENT',
  'CONVEX_SITE_URL',
  'CONVEX_URL',
  'NUXT_PUBLIC_CONVEX_SITE_URL',
  'NUXT_PUBLIC_CONVEX_URL',
]) {
  delete env[name]
}

run(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--disableConsoleIntercept',
    '--project=e2e',
    'test/e2e/extended/auth-two-factor.e2e.test.ts',
  ],
  { env },
)

if (existsSync(fixturePackageLink)) {
  throw new Error('Two-factor E2E left its temporary better-convex-nuxt package link behind')
}
