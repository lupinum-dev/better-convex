#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { proveNotesDashboardBrowserBoundary } from '../internal/labs/mcp-topology/apps/notes-dashboard/browser-proof.ts'
import { buildNotesDashboard } from '../internal/labs/mcp-topology/apps/notes-dashboard/build.ts'
import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const repositoryManifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const scratchRoot = mkdtempSync(join(tmpdir(), 'better-convex-mcp-app-consumer-'))
const consumerRoot = scratchRoot
const token = 'packed-mcp-app-bearer-sentinel'

function parseArguments(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if ((flag !== '--vue-tarball' && flag !== '--mcp-tarball') || !value) {
      throw new Error(
        'Usage: check-vue-mcp-app-consumer.mjs --vue-tarball <path> --mcp-tarball <path>',
      )
    }
    values[flag.slice(2)] = resolve(repositoryRoot, value)
  }
  if (!values['vue-tarball'] || !values['mcp-tarball'] || Object.keys(values).length !== 2) {
    throw new Error(
      'Usage: check-vue-mcp-app-consumer.mjs --vue-tarball <path> --mcp-tarball <path>',
    )
  }
  return values
}

function run(command, args) {
  execFileSync(command, args, { cwd: consumerRoot, stdio: 'inherit' })
}

const args = parseArguments(process.argv.slice(2))
const vueCandidate = inspectConsumerCandidate({
  packageId: 'vue',
  packageName: 'better-convex-vue',
  tarballPath: args['vue-tarball'],
})
const mcpCandidate = inspectConsumerCandidate({
  packageId: 'mcp',
  packageName: 'better-convex-mcp',
  tarballPath: args['mcp-tarball'],
})
const officialClientVersion = repositoryManifest.devDependencies?.['@modelcontextprotocol/client']
const officialAppsVersion =
  vueCandidate.manifest.peerDependencies?.['@modelcontextprotocol/ext-apps']
const officialServerVersion = mcpCandidate.manifest.dependencies?.['@modelcontextprotocol/server']
const reviewedVueVersion = vueCandidate.manifest.devDependencies?.vue
for (const [name, version] of Object.entries({
  '@modelcontextprotocol/client': officialClientVersion,
  '@modelcontextprotocol/ext-apps': officialAppsVersion,
  '@modelcontextprotocol/server': officialServerVersion,
  vue: reviewedVueVersion,
})) {
  if (typeof version !== 'string') throw new TypeError(`Reviewed package manifest omits ${name}.`)
}

try {
  cpSync(args['vue-tarball'], join(scratchRoot, 'better-convex-vue.tgz'))
  cpSync(args['mcp-tarball'], join(scratchRoot, 'better-convex-mcp.tgz'))
  writeFileSync(
    join(scratchRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        packageManager: repositoryManifest.packageManager,
        dependencies: {
          'better-convex-mcp': 'file:./better-convex-mcp.tgz',
          '@modelcontextprotocol/client': officialClientVersion,
          '@modelcontextprotocol/ext-apps': officialAppsVersion,
          '@modelcontextprotocol/server': officialServerVersion,
          'better-convex-vue': 'file:./better-convex-vue.tgz',
          vue: reviewedVueVersion,
          zod: '4.4.3',
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(scratchRoot, 'pnpm-workspace.yaml'),
    `minimumReleaseAgeExclude:
  - '${mcpCandidate.manifest.name}@${mcpCandidate.manifest.version}'
  - '${vueCandidate.manifest.name}@${vueCandidate.manifest.version}'
`,
  )
  run('pnpm', [
    'install',
    '--frozen-lockfile=false',
    '--ignore-scripts',
    '--strict-peer-dependencies',
  ])
  run('pnpm', [
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--offline',
    '--strict-peer-dependencies',
  ])

  const lock = readFileSync(join(scratchRoot, 'pnpm-lock.yaml'), 'utf8')
  if (!lock.includes('better-convex-vue.tgz') || !lock.includes('better-convex-mcp.tgz')) {
    throw new Error('Packed MCP App consumer lock does not bind both candidate tarballs.')
  }

  const installedVue = join(scratchRoot, 'node_modules/better-convex-vue')
  const installedMcp = join(scratchRoot, 'node_modules/better-convex-mcp')
  vueCandidate.assertInstalled(installedVue)
  mcpCandidate.assertInstalled(installedMcp)

  const consumerRequire = createRequire(join(scratchRoot, 'package.json'))
  const build = await buildNotesDashboard({
    extAppsBridgeEntry: consumerRequire.resolve('@modelcontextprotocol/ext-apps/app-bridge'),
    extAppsEntry: consumerRequire.resolve('@modelcontextprotocol/ext-apps'),
    mcpAppEntry: join(installedVue, 'dist/mcp-app.mjs'),
  })
  const installedMcpAppEntry = realpathSync(join(installedVue, 'dist/mcp-app.mjs'))
  if (!build.appModules.includes(installedMcpAppEntry)) {
    throw new Error('Production App bundle did not consume the installed Vue candidate bytes.')
  }
  if (build.appModules.some((moduleId) => moduleId.includes('/packages/vue/src/'))) {
    throw new Error('Production App bundle fell back to Vue package source.')
  }

  const [{ handleMcpRequest }, { Client, StreamableHTTPClientTransport }, { z }] =
    await Promise.all([
      import(pathToFileURL(join(installedMcp, 'dist/index.mjs')).href),
      import(
        pathToFileURL(join(scratchRoot, 'node_modules/@modelcontextprotocol/client/dist/index.mjs'))
          .href
      ),
      import(pathToFileURL(join(scratchRoot, 'node_modules/zod/index.js')).href),
    ])
  const mcpOptions = {
    authorization: {
      issuer: 'https://packed-app.invalid/issuer/',
      mode: 'preconfigured-bearer',
    },
    resource: new URL('https://packed-app.invalid/mcp'),
    verifier: {
      async verifyAccessToken(value, expectedResource) {
        if (value !== token || expectedResource.href !== 'https://packed-app.invalid/mcp') {
          throw new Error('invalid')
        }
        return {
          access: {
            clientId: 'packed-app-client',
            issuer: 'https://packed-app.invalid/issuer/',
            resource: expectedResource.href,
            scopes: ['notes:read'],
            subject: 'alice',
          },
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
        }
      },
    },
    configureServer(_access, server) {
      server.registerTool(
        'search_notes',
        {
          inputSchema: z
            .object({
              limit: z.number().int().min(1).max(50).optional(),
              query: z.string(),
              workspaceId: z.string(),
            })
            .strict(),
          outputSchema: z.object({ matches: z.array(z.unknown()) }),
        },
        async (input) => {
          if (input.workspaceId !== 'workspace-a' || input.query === 'revoked') {
            return {
              content: [
                {
                  type: 'text',
                  text: 'The request is not currently authorized.',
                },
              ],
              isError: true,
            }
          }
          return {
            content: [{ type: 'text', text: '1 note matched.' }],
            structuredContent: {
              matches: [
                {
                  body: 'Alpha body',
                  id: 'note-a',
                  revision: 1,
                  title: 'Alpha',
                  uri: 'note://note-a',
                  workspaceId: 'workspace-a',
                },
              ],
            },
          }
        },
      )
    },
  }

  let lastProtocolFailure
  const transport = new StreamableHTTPClientTransport(new URL('https://packed-app.invalid/mcp'), {
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${token}`)
      const response = await handleMcpRequest(new Request(request, { headers }), mcpOptions)
      if (!response.ok) {
        lastProtocolFailure = `HTTP ${response.status}`
        return response
      }
      try {
        const envelope = await response.clone().json()
        if (envelope?.error) {
          lastProtocolFailure = `${String(envelope.error.code)}: ${String(envelope.error.message)}`
        }
      } catch {
        // The official transport remains the parser and will report malformed responses.
      }
      return response
    },
  })
  const client = new Client(
    { name: 'packed-app-consumer', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  try {
    await client.connect(transport)
  } catch {
    throw new Error(
      `Exact MCP candidate negotiation failed (${lastProtocolFailure ?? 'no safe protocol detail'}).`,
    )
  }
  try {
    const fallback = await client.callTool({
      arguments: { query: 'alpha', workspaceId: 'workspace-a' },
      name: 'search_notes',
    })
    if (
      fallback?.content?.[0]?.text !== '1 note matched.' ||
      fallback?.structuredContent?.matches?.[0]?.title !== 'Alpha'
    ) {
      throw new Error('Exact MCP candidate did not preserve the useful baseline fallback.')
    }
    await proveNotesDashboardBrowserBoundary({
      additionalSecretSentinels: [token],
      build,
      callTool: async (call) => await client.callTool(call),
    })
    if (build.appHtml.includes(token) || JSON.stringify(fallback).includes(token)) {
      throw new Error('Exact package bearer escaped into the App or fallback result.')
    }
    console.log(
      `Packed MCP App consumer passed Vue ${vueCandidate.manifest.version} with MCP ${mcpCandidate.manifest.version}.`,
    )
  } finally {
    await client.close()
  }
} finally {
  vueCandidate.cleanup()
  mcpCandidate.cleanup()
  rmSync(scratchRoot, { force: true, recursive: true })
}
