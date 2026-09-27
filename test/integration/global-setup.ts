// Runs once before the integration project: the suites install the built
// packages into temporary apps, and every suite needs the pinned backend.
import { execFileSync } from 'node:child_process'

import { ensureLocalBackend } from '../helpers/local-backend.mjs'
import { cleanEnvironment, root } from './harness'

export default async function setup() {
  await ensureLocalBackend()
  if (process.env.BCN_INTEGRATION_SKIP_BUILD === '1') return
  for (const args of [
    ['--filter', '@lupinum/better-convex-mcp', 'build'],
    ['--filter', '@lupinum/better-convex-vue', 'build'],
    ['exec', 'nuxt-module-build', 'prepare'],
    ['exec', 'nuxt-module-build', 'build'],
  ]) {
    execFileSync('pnpm', args, { cwd: root, env: cleanEnvironment(), stdio: 'inherit' })
  }
}
