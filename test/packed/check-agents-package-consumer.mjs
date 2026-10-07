#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const repositoryManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-agents-consumer-'))
const { tarballPath, functionsTarballPath } = parseTarballs(process.argv.slice(2))
const candidate = inspectConsumerCandidate({
  packageName: '@lupinum/better-convex-agents',
  tarballPath,
})
// The official SDK is a peer, so the consumer and the package share one copy.
const officialServerVersion = candidate.manifest.peerDependencies?.['@modelcontextprotocol/server']
const reviewedZodVersion = repositoryManifest.devDependencies?.zod
if (typeof officialServerVersion !== 'string') {
  throw new TypeError('Agents candidate does not declare the official server SDK as a peer.')
}
if (candidate.manifest.dependencies?.['@modelcontextprotocol/server']) {
  throw new TypeError('Agents candidate must not bundle its own copy of the official server SDK.')
}
if (typeof reviewedZodVersion !== 'string') {
  throw new TypeError('Repository manifest does not declare the reviewed Zod contract.')
}

function parseTarballs(args) {
  if (args.length !== 4 || args[0] !== '--tarball' || args[2] !== '--functions-tarball') {
    throw new Error(
      'Usage: check-agents-package-consumer.mjs --tarball <path> --functions-tarball <path>',
    )
  }
  return {
    tarballPath: resolve(repositoryRoot, args[1]),
    functionsTarballPath: resolve(repositoryRoot, args[3]),
  }
}

function run(command, args) {
  execFileSync(command, args, { cwd: scratchRoot, stdio: 'inherit' })
}

try {
  cpSync(tarballPath, join(scratchRoot, 'better-convex-agents.tgz'))
  cpSync(functionsTarballPath, join(scratchRoot, 'better-convex-functions.tgz'))
  writeFileSync(join(scratchRoot, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 1440\n')
  writeFileSync(
    join(scratchRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@lupinum/better-convex-agents': 'file:./better-convex-agents.tgz',
          '@lupinum/better-convex-functions': 'file:./better-convex-functions.tgz',
          '@modelcontextprotocol/server': officialServerVersion,
          convex: repositoryManifest.devDependencies.convex,
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
    `import type { McpServer } from '@modelcontextprotocol/server'\nimport { defineFunctions, definePolicy } from '@lupinum/better-convex-functions'\nimport { defineTools } from '@lupinum/better-convex-agents'\nimport { createMcpServer, handleMcpRequest, type HandleMcpRequestOptions, type McpAccessContext, type McpAccessVerifier, type McpDoorAuth, type VerifiedMcpAccess, listMcpCatalog } from '@lupinum/better-convex-agents/mcp'\nimport { refs, testAuth } from '@lupinum/better-convex-agents/test'\nimport { z } from 'zod'\n\nconst resource = new URL('https://resource.example/mcp')\nconst access: McpAccessContext = { issuer: 'https://issuer.example', subject: 'alice', clientId: 'client', resource: resource.href, scopes: ['notes:read'] }\nconst verifier: McpAccessVerifier = { async verifyAccessToken(_token, expected): Promise<VerifiedMcpAccess> { if (expected.issuer !== access.issuer || expected.resource.href !== resource.href) throw new Error('invalid'); return { access, expiresAt: 4_102_444_800 } } }\nconst options: HandleMcpRequestOptions = { serverInfo: { name: 'consumer', version: '1.0.0' }, resource, authorization: { mode: 'oauth', issuer: access.issuer, verifier }, configureServer({ access: nextAccess, server, tools }) { const directServer: McpServer = server; directServer.registerTool('typed', { inputSchema: z.object({}) }, async () => tools.runTool('typed', async () => ({ content: [{ type: 'text', text: 'ok' }] }))); void nextAccess } }\ndeclare const request: Request\nvoid handleMcpRequest(request, options)\nvoid listMcpCatalog({ configureServer: options.configureServer, access, principal: undefined })\nconst policy = definePolicy({ actions: ['notes.read'], roles: { owner: ['*'] }, scopes: {} })\ndeclare const fns: Parameters<typeof defineTools>[0]\nconst tools = defineTools(fns, {}, { functions: refs('agents') })\nconst auth: McpDoorAuth = testAuth().auth\nvoid createMcpServer(auth, { name: 'consumer', agents: { tools, ...tools.functions } })\nvoid policy\nvoid defineFunctions\n`,
  )
  cpSync(
    join(repositoryRoot, 'test/packed/agents-packed-credential-proof.mjs'),
    join(scratchRoot, 'runtime-proof.mjs'),
  )

  run('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies'])
  run('pnpm', ['exec', 'tsc', '--noEmit'])
  run('node', ['runtime-proof.mjs'])

  const installedRoot = join(scratchRoot, 'node_modules/@lupinum/better-convex-agents')
  candidate.assertInstalled(installedRoot)
  const entries = {
    'dist/index.mjs': 'defineTools',
    'dist/mcp.mjs':
      'McpUnsupportedCapabilityError,createMcpServer,handleMcpRequest,projectMcpToolError',
  }
  for (const [entry, allowed] of Object.entries(entries)) {
    const imported = await import(pathToFileURL(join(installedRoot, entry)).href)
    if (Object.keys(imported).sort().join(',') !== allowed) {
      throw new Error(`Agents entry ${entry} does not match the reviewed export allowlist.`)
    }
  }
  const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  const installedServer = JSON.parse(
    readFileSync(
      join(scratchRoot, 'node_modules/@modelcontextprotocol/server/package.json'),
      'utf8',
    ),
  )
  if (
    manifest.peerDependencies?.['@modelcontextprotocol/server'] !== officialServerVersion ||
    installedServer.version !== officialServerVersion
  ) {
    throw new Error('Agents consumer did not install the exact official SDK contract.')
  }
  console.log(`Agents exact-tarball contract consumer passed (${candidate.manifest.version}).`)
} finally {
  rmSync(scratchRoot, { recursive: true, force: true })
}
