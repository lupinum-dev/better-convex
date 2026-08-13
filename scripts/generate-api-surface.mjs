#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

import ts from 'typescript'

import { getPackageEntryManifest } from './package-entry-manifest.mjs'

const rootDir = process.cwd()
const apiSurfacePath = resolve(rootDir, 'src/module-api-surface.ts')
const outputPath = resolve(rootDir, 'docs/content/docs/6.reference/7.api-surface.md')
const packageJsonPath = resolve(rootDir, 'package.json')
const checkOnly = process.argv.includes('--check')
const packageEntryManifest = getPackageEntryManifest('nuxt')

const apiSurfaceSource = readFileSync(apiSurfacePath, 'utf8')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

function loadApiSurfaceRegistry() {
  const transpiled = ts.transpileModule(apiSurfaceSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: apiSurfacePath,
  }).outputText

  const module = { exports: {} }
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
  })
  return module.exports
}

const apiSurfaceRegistry = loadApiSurfaceRegistry()

function normalizeRepoUrl(input) {
  if (typeof input !== 'string') return null
  const cleaned = input
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
  return cleaned.startsWith('https://') ? cleaned : null
}

const repoBase =
  normalizeRepoUrl(packageJson?.repository?.url) ??
  'https://github.com/lupinum-dev/better-convex-nuxt'

function extractNamesFromRegistry(registryName) {
  const registry = apiSurfaceRegistry[registryName]
  if (!Array.isArray(registry)) {
    throw new TypeError(`Could not find ${registryName} array in ${apiSurfacePath}`)
  }

  return [
    ...new Set(
      registry.map((entry) => {
        if (!entry || typeof entry.name !== 'string') {
          throw new TypeError(`${registryName} contains an entry without a string name`)
        }
        return entry.name
      }),
    ),
  ].sort((a, b) => a.localeCompare(b))
}

const composableImports = extractNamesFromRegistry('composableAutoImports')
const authImports = extractNamesFromRegistry('authAutoImports')
const serverImports = extractNamesFromRegistry('serverAutoImports')
const packageContract = packageEntryManifest.entries.map(
  ({ subpath, valueExports, typeExports }) => ({
    subpath,
    valueExports,
    typeExports,
  }),
)

function toPackageEntryRows(entries) {
  return entries
    .map(({ subpath, valueExports, typeExports }) => {
      const specifier =
        subpath === '.'
          ? packageEntryManifest.packageName
          : `${packageEntryManifest.packageName}/${subpath.slice(2)}`
      const values = valueExports.map((name) => `\`${name}\``).join(', ')
      const types = typeExports.map((name) => `\`${name}\``).join(', ')
      return `| \`${specifier}\` | ${values || '—'} | ${types || '—'} |`
    })
    .join('\n')
}
const composableMeta = {
  useConvex: {
    kind: 'Composable',
    purpose: 'Returns the stable replacement-safe handle for imperative Convex calls.',
    guide: '/docs/understand/server-and-client-boundaries',
  },
  useConvexAction: {
    kind: 'Composable',
    purpose: 'Runs Convex actions with reactive status and error handling.',
    guide: '/docs/build/write-data/actions',
  },
  useConvexAttachment: {
    kind: 'Composable',
    purpose: 'Returns the frozen token-free runtime boundary for an embedded Vue application.',
    guide: '/docs/reference/composables',
  },
  useConvexAuth: {
    kind: 'Composable',
    purpose: 'Tracks auth state and user/session information in Nuxt.',
    guide: '/docs/build/authentication/auth-state-and-user',
  },
  useConvexConfig: {
    kind: 'Composable',
    purpose: 'Returns the readonly public Convex deployment URLs.',
    guide: '/docs/reference/module-configuration',
  },
  useConvexConnectionState: {
    kind: 'Composable',
    purpose: 'Observes the exact live Convex transport state.',
    guide: '/docs/build/application-behavior/connection-state',
  },
  useConvexFileUpload: {
    kind: 'Composable',
    purpose: 'Uploads files to Convex storage with progress tracking.',
    guide: '/docs/build/files/upload-files',
  },
  useConvexMutation: {
    kind: 'Composable',
    purpose: 'Runs Convex mutations with status, errors, and optimistic hooks.',
    guide: '/docs/build/write-data/mutations',
  },
  useConvexPaginatedQuery: {
    kind: 'Composable',
    purpose: 'Returns one reactive, SSR-aware pagination lifecycle.',
    guide: '/docs/build/queries/pagination',
  },
  useConvexQuery: {
    kind: 'Composable',
    purpose: 'Returns one reactive SSR-to-realtime query lifecycle.',
    guide: '/docs/build/queries/queries',
  },
}

const serverMeta = {
  serverConvex: {
    kind: 'Server helper',
    purpose:
      'Creates a request-scoped server caller with query/mutation/action for server routes and handlers.',
    guide: '/docs/build/server/server-convex',
  },
}

function fallbackMeta(name, defaultKind = 'Helper') {
  return {
    kind: name.startsWith('use') ? 'Composable' : defaultKind,
    purpose: 'Auto-imported runtime API provided by this module.',
    guide: '/docs/reference/composables',
  }
}

function toRows(names, meta, options = {}) {
  const { defaultKind = 'Helper' } = options
  return names
    .map((name) => {
      const details = meta[name] ?? fallbackMeta(name, defaultKind)
      return `| \`${name}\` | ${details.kind} | ${details.purpose} | [Guide](${details.guide}) |`
    })
    .join('\n')
}

const file = `---
title: API Surface
description: Generated reference of auto-imported composables, server helpers, aliases, and package entries.
navigation:
  icon: i-lucide-list
---

This page is generated from the reviewed module and package entrypoint registries.

Source of truth:
- [src/module-api-surface.ts](${repoBase}/blob/main/src/module-api-surface.ts)
- [scripts/package-entry-manifest.mjs](${repoBase}/blob/main/scripts/package-entry-manifest.mjs)
- [src/runtime/server/utils](${repoBase}/tree/main/src/runtime/server/utils)

This reference answers:
- Which APIs are auto-imported?
- Which Nuxt aliases are registered?
- What is each API for?
- Where is the best guide for examples and deeper usage?

Regenerate this page with:

\`\`\`bash
node scripts/generate-api-surface.mjs
\`\`\`

## Nuxt Aliases

| Alias | Points To | Supported Contexts |
| ----- | --------- | ------------------ |
| \`#convex/api\` | Your app's \`convex/_generated/api\` | Vue components, composables, route middleware, Nitro server routes, tests |
| \`#convex/server\` | \`better-convex-nuxt\` server exports | Nitro server routes and Convex-adjacent server utilities |
| \`#convex/auth-client\` | The configured Better Auth client definition | Auth-enabled builds only |

Use \`#convex/api\` for generated Convex functions:

\`\`\`ts
import { api } from '#convex/api'
\`\`\`

Before Convex codegen creates \`convex/_generated/api\`, this alias points to a typed placeholder that keeps imports working and fails with a codegen message if accessed.

## Published Package Entries

| Import Specifier | Runtime Exports | Type Exports |
| ---------------- | --------------- | ------------ |
${toPackageEntryRows(packageContract)}

Use \`#convex/server\` when an explicit server import is clearer than relying on Nuxt auto-imports, or for exports that are intentionally not auto-imported:

\`\`\`ts
import { serverConvex } from '#convex/server'
\`\`\`

\`createUserProjectionTriggers\` runs inside your \`convex/\` functions. Import it from the Better Auth integration subpath:

\`\`\`ts
import { createUserProjectionTriggers } from 'better-convex-nuxt/convex-auth'
\`\`\`

## Core Composable Auto-Imports

These composables are available in every build. Omitting \`convex.auth\` keeps Better Auth, its proxy, its middleware, its page metadata, and \`useConvexAuth\` out of the application surface.

| Name | Kind | Purpose | Learn More |
| ---- | ---- | ------- | ---------- |
${toRows(composableImports, composableMeta)}

\`useConvexQuery\` accepts \`auth\`, \`keepPreviousData\`, and Nuxt's \`server\` option. Its state is \`data\`, \`status\`, \`pending\`, \`error\`, \`isStale\`, and \`refresh()\`. These option and state lists are exhaustive.

\`useConvexPaginatedQuery\` requires a positive \`initialNumItems\`. Its state is \`data\`, \`status\`, \`isLoading\`, \`canLoadMore\`, \`error\`, \`isStale\`, \`loadMore()\`, and \`refresh()\`.

## Auth-Enabled Auto-Imports

Auth is an explicit opt-in:

\`\`\`ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['better-convex-nuxt'],
  convex: {
    auth: {
      origin: process.env.SITE_URL ?? 'http://localhost:3000',
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
\`\`\`

Only an auth-enabled build auto-imports the following API. Define its typed Better Auth client with \`defineConvexAuthClient\` from \`better-convex-nuxt/auth-client\`, then access the integrated client through \`useConvexAuth().client\`.

| Name | Kind | Purpose | Learn More |
| ---- | ---- | ------- | ---------- |
${toRows(authImports, composableMeta)}

Render auth UI with ordinary Vue conditionals over \`status\`, \`isPending\`, and \`error\`. The module does not register auth UI components.

## Server Auto-Imports

| Name | Kind | Purpose | Learn More |
| ---- | ---- | ------- | ---------- |
${toRows(serverImports, serverMeta, { defaultKind: 'Server helper' })}
`

if (checkOnly) {
  const current = readFileSync(outputPath, 'utf8')
  if (current !== file) {
    console.error(`${outputPath} is stale. Run: pnpm run docs:api-surface`)
    process.exit(1)
  }
  console.log(`API surface docs are up to date (${outputPath})`)
} else {
  writeFileSync(outputPath, file)
  console.log(`Generated ${outputPath}`)
}
