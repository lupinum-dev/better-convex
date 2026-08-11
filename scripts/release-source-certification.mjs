#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

export const sourceCertificationLanes = Object.freeze({
  auth: Object.freeze([
    Object.freeze({ command: 'pnpm', args: Object.freeze(['run', 'verify:auth']) }),
  ]),
  core: Object.freeze([Object.freeze({ command: 'pnpm', args: Object.freeze(['run', 'verify']) })]),
  e2e: Object.freeze([
    Object.freeze({
      command: 'pnpm',
      args: Object.freeze(['run', 'test:e2e:full']),
      environment: Object.freeze({ CONVEX_E2E_AUTO_START: 'true', BCN_E2E_REQUIRE_LOCAL: 'true' }),
    }),
    Object.freeze({ command: 'pnpm', args: Object.freeze(['run', 'test:dast:proxy']) }),
    Object.freeze({ command: 'pnpm', args: Object.freeze(['run', 'check:auth-advisories']) }),
  ]),
})

export function runSourceCertificationLane(lane) {
  const commands = sourceCertificationLanes[lane]
  if (!commands) {
    throw new Error(`Unknown source-certification lane: ${lane ?? '(missing)'}`)
  }
  for (const entry of commands) {
    console.log(`\n> ${[entry.command, ...entry.args].join(' ')}`)
    execFileSync(entry.command, entry.args, {
      cwd: root,
      env: { ...process.env, ...entry.environment },
      stdio: 'inherit',
    })
  }
  console.log(`\n[release-source-certification] PASS: ${lane}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: release-source-certification.mjs auth|core|e2e')
  }
  runSourceCertificationLane(process.argv[2])
}
