#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const repositoryManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-mcp-consumer-'))
const tarballPath = parseTarball(process.argv.slice(2))
const candidate = inspectConsumerCandidate({
  packageId: 'mcp',
  packageName: 'better-convex-mcp',
  tarballPath,
})
const officialServerVersion = candidate.manifest.dependencies?.['@modelcontextprotocol/server']
const reviewedZodVersion = repositoryManifest.devDependencies?.zod
if (typeof officialServerVersion !== 'string') {
  throw new TypeError('MCP candidate does not declare the official server SDK.')
}
if (typeof reviewedZodVersion !== 'string') {
  throw new TypeError('Repository manifest does not declare the reviewed Zod contract.')
}

function parseTarball(args) {
  if (args.length !== 2 || args[0] !== '--tarball' || !args[1]) {
    throw new Error('Usage: check-mcp-package-consumer.mjs --tarball <path>')
  }
  return resolve(repositoryRoot, args[1])
}

function run(command, args) {
  execFileSync(command, args, { cwd: scratchRoot, stdio: 'inherit' })
}

try {
  cpSync(tarballPath, join(scratchRoot, 'better-convex-mcp.tgz'))
  writeFileSync(
    join(scratchRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          'better-convex-mcp': 'file:./better-convex-mcp.tgz',
          '@modelcontextprotocol/server': officialServerVersion,
          '@types/node': '22.20.1',
          typescript: '5.9.3',
          zod: reviewedZodVersion,
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(scratchRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(scratchRoot, 'consumer.ts'),
    `import type { McpServer } from '@modelcontextprotocol/server'\nimport { z } from 'zod'\nimport { handleMcpRequest, runMcpTool, type HandleMcpRequestOptions, type McpAccessContext, type McpAccessVerifier, type VerifiedMcpAccess } from 'better-convex-mcp'\n\nconst resource = new URL('https://resource.example/mcp')\nconst access: McpAccessContext = { issuer: 'https://issuer.example', subject: 'alice', clientId: 'client', resource: resource.href, scopes: ['notes:read'] }\nconst verifier: McpAccessVerifier = { async verifyAccessToken(_token, expected): Promise<VerifiedMcpAccess> { if (expected.issuer !== access.issuer || expected.resource.href !== resource.href) throw new Error('invalid'); return { access, expiresAt: 4_102_444_800 } } }\nconst options: HandleMcpRequestOptions = { serverInfo: { name: 'consumer', version: '1.0.0' }, resource, authorization: { mode: 'oauth', issuer: access.issuer, verifier }, configureServer(nextAccess, server) { const directServer: McpServer = server; directServer.registerTool('typed', { inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: 'ok' }] })); void nextAccess } }\ndeclare const request: Request\nvoid handleMcpRequest(request, options)\nvoid runMcpTool(async () => ({ resultType: 'input_required' as const, requestState: 'opaque-state' }))\n// @ts-expect-error arbitrary objects are not official tool callback results\nvoid runMcpTool(async () => ({ arbitrary: true }))\n`,
  )
  cpSync(
    join(repositoryRoot, 'scripts/fixtures/mcp-packed-credential-proof.mjs'),
    join(scratchRoot, 'runtime-proof.mjs'),
  )

  run('pnpm', [
    'install',
    '--frozen-lockfile=false',
    '--ignore-scripts',
    '--strict-peer-dependencies',
  ])
  run('pnpm', ['exec', 'tsc', '--noEmit'])
  run('node', ['runtime-proof.mjs'])

  const installedRoot = join(scratchRoot, 'node_modules/better-convex-mcp')
  candidate.assertInstalled(installedRoot)
  const imported = await import(pathToFileURL(join(installedRoot, 'dist/index.mjs')).href)
  if (Object.keys(imported).sort().join(',') !== 'handleMcpRequest,runMcpTool') {
    throw new Error('MCP runtime entry does not match the reviewed export allowlist.')
  }
  const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  if (manifest.dependencies?.['@modelcontextprotocol/server'] !== officialServerVersion) {
    throw new Error('MCP consumer did not install the exact official SDK contract.')
  }
  console.log(`MCP exact-tarball contract consumer passed (${candidate.manifest.version}).`)
} finally {
  candidate.cleanup()
  rmSync(scratchRoot, { recursive: true, force: true })
}
