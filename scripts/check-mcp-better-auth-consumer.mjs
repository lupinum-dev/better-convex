#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const tarballPath = parseTarball(process.argv.slice(2))
const candidate = inspectConsumerCandidate({
  packageId: 'mcp',
  packageName: 'better-convex-mcp',
  tarballPath,
})

function parseTarball(args) {
  if (args.length !== 2 || args[0] !== '--tarball' || !args[1]) {
    throw new Error('Usage: check-mcp-better-auth-consumer.mjs --tarball <path>')
  }
  return resolve(repositoryRoot, args[1])
}

try {
  execFileSync(process.execPath, ['scripts/run-mcp-conformance.mjs'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BCN_MCP_RELEASE_TARBALL: tarballPath,
    },
    stdio: 'inherit',
  })
  console.log(
    `MCP Better Auth production consumer passed exact ${candidate.manifest.name}@${candidate.manifest.version}.`,
  )
} finally {
  candidate.cleanup()
}
