#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

import ts from 'typescript'

import { getPackageEntryManifest } from './package-entry-manifest.mjs'

const rootDir = process.cwd()
const apiSurfacePath = resolve(rootDir, 'src/module-api-surface.ts')
const outputPath = resolve(rootDir, 'docs/content/docs/7.reference/7.api-surface.md')
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
  normalizeRepoUrl(packageJson?.repository?.url) ?? 'https://github.com/lupinum-dev/better-convex'

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
/**
 * Read the member names of an exported interface or object type alias from
 * source. Function-valued members get a `()` suffix. Heritage clauses and
 * referenced types are not followed; callers combine the declarations they need.
 */
function readTypeMembers(relativePath, typeName) {
  const path = resolve(rootDir, relativePath)
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)
  const declaration = source.statements.find(
    (statement) =>
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === typeName,
  )
  if (!declaration) throw new TypeError(`Could not find ${typeName} in ${relativePath}`)

  const names = []
  const addMembers = (members) => {
    for (const member of members) {
      if (!member.name || !ts.isIdentifier(member.name)) continue
      const isFunction =
        ts.isMethodSignature(member) ||
        (ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type))
      const name = isFunction ? `${member.name.text}()` : member.name.text
      if (!names.includes(name)) names.push(name)
    }
  }
  const visitType = (node) => {
    if (ts.isTypeLiteralNode(node)) addMembers(node.members)
    else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node))
      node.types.forEach(visitType)
    else if (ts.isParenthesizedTypeNode(node)) visitType(node.type)
  }
  if (ts.isInterfaceDeclaration(declaration)) addMembers(declaration.members)
  else visitType(declaration.type)
  return names
}

function unionOf(...lists) {
  return [...new Set(lists.flat())]
}

function formatList(names, conjunction = 'and') {
  const items = names.map((name) => `\`${name}\``)
  if (items.length <= 2) return items.join(` ${conjunction} `)
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items.at(-1)}`
}

const vueQueryFile = 'packages/vue/src/use-query.ts'
const vuePaginationFile = 'packages/vue/src/use-paginated-query.ts'
const vueCallableFile = 'packages/vue/src/use-callable.ts'
const nuxtQueryFile = 'src/runtime/composables/useConvexQuery.ts'
const nuxtPaginationFile = 'src/runtime/composables/useConvexPaginatedQuery.ts'

const vueQueryOptions = readTypeMembers(vueQueryFile, 'UseConvexQueryOptions')
const nuxtQueryOptions = unionOf(
  vueQueryOptions,
  readTypeMembers(nuxtQueryFile, 'UseNuxtConvexQueryBaseOptions'),
  readTypeMembers(nuxtQueryFile, 'UseNuxtConvexQueryOptions'),
)
const queryState = readTypeMembers(vueQueryFile, 'UseConvexQueryState')
const vuePaginationOptions = readTypeMembers(vuePaginationFile, 'UseConvexPaginatedQueryOptions')
const nuxtPaginationOptions = unionOf(
  vuePaginationOptions,
  readTypeMembers(nuxtPaginationFile, 'UseNuxtConvexPaginatedQueryBaseOptions'),
  readTypeMembers(nuxtPaginationFile, 'UseNuxtConvexPaginatedQueryOptions'),
)
const paginationState = readTypeMembers(vuePaginationFile, 'UseConvexPaginatedQueryState')
const mutationReturn = readTypeMembers(vueCallableFile, 'UseConvexMutationReturn')
const actionReturn = readTypeMembers(vueCallableFile, 'UseConvexActionReturn')
const serverCaller = readTypeMembers(
  'src/runtime/server/utils/server-convex-caller.ts',
  'ServerConvexCaller',
)
const nuxtOnlyQueryOptions = nuxtQueryOptions.filter((name) => !vueQueryOptions.includes(name))

const composableMeta = {
  useConvex: {
    kind: 'Composable',
    purpose:
      'Returns one stable handle with `query`, `mutation`, `action`, and `onUpdate` for direct Convex calls.',
    guide: '/docs/concepts/server-and-client-boundaries',
  },
  useConvexAction: {
    kind: 'Composable',
    purpose: `Runs a Convex action. Returns ${formatList(actionReturn)}.`,
    guide: '/docs/build/write-data/actions',
  },
  useConvexAttachment: {
    kind: 'Composable',
    purpose:
      'Returns the browser attachment that an embedded Vue application passes to `createBetterConvex`. It contains no credentials.',
    guide: '/docs/reference/composables#client-and-configuration',
  },
  useConvexAuth: {
    kind: 'Composable',
    purpose:
      'Returns auth `status`, `pending`, `user`, `error`, the Better Auth `client`, and `ready()`.',
    guide: '/docs/build/authentication/auth-state-and-user',
  },
  useConvexAuthReturnTo: {
    kind: 'Composable',
    purpose: 'Returns the validated local return path from the sign-in redirect query.',
    guide: '/docs/build/authentication/route-protection',
  },
  normalizeLocalRedirectPath: {
    kind: 'Helper',
    purpose: 'Returns a safe local application path, or null for any other value.',
    guide: '/docs/build/authentication/route-protection',
  },
  useConvexConfig: {
    kind: 'Composable',
    purpose: 'Returns the readonly public Convex deployment URLs.',
    guide: '/docs/reference/module-configuration',
  },
  useConvexConnectionState: {
    kind: 'Composable',
    purpose: 'Returns the live Convex connection state and the pending mutation and action counts.',
    guide: '/docs/build/application-behavior/connection-state',
  },
  useConvexFileUpload: {
    kind: 'Composable',
    purpose:
      'Uploads one file at a time to Convex storage with progress, `cancel()`, and `reset()`.',
    guide: '/docs/build/files/upload-files',
  },
  useConvexMutation: {
    kind: 'Composable',
    purpose: `Runs a Convex mutation. Returns ${formatList(mutationReturn)}.`,
    guide: '/docs/build/write-data/mutations',
  },
  useConvexForm: {
    kind: 'Composable',
    purpose:
      'Validates form values with a Standard Schema and submits them to one Convex mutation.',
    guide: '/docs/build/write-data/forms',
  },
  useConvexPaginatedQuery: {
    kind: 'Composable',
    purpose:
      'Loads a paginated Convex query. The server renders the first page, and the browser loads more pages and keeps them live.',
    guide: '/docs/build/queries/pagination',
  },
  useConvexQuery: {
    kind: 'Composable',
    purpose: 'Loads a Convex query. The server renders it, and the browser keeps it live.',
    guide: '/docs/build/queries/queries',
  },
}

const serverMeta = {
  getConvexUser: {
    kind: 'Server helper',
    purpose: 'Reads the signed-in user for the request, or `null` when it is anonymous.',
    guide: '/docs/build/server/server-convex',
  },
  requireConvexUser: {
    kind: 'Server helper',
    purpose: 'Reads the signed-in user for the request, or throws an H3 401 error.',
    guide: '/docs/build/server/server-convex',
  },
  toConvexH3Error: {
    kind: 'Server helper',
    purpose:
      'Maps any thrown value to an H3 error whose `data` is the serialized `ConvexCallError`.',
    guide: '/docs/build/server/server-convex',
  },
  serverConvex: {
    kind: 'Server helper',
    purpose: `Creates a caller for one Nitro request. It has ${formatList(serverCaller)}.`,
    guide: '/docs/build/server/server-convex',
  },
}

function fallbackMeta(name, defaultKind = 'Helper') {
  return {
    kind: name.startsWith('use') ? 'Composable' : defaultKind,
    purpose: 'Auto-imported by the module.',
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
title: API surface
description: Generated reference of auto-imported composables, server helpers, aliases, and package entries.
navigation:
  icon: i-lucide-list
---

A script generates this page from the source files below. Do not edit it by hand.

Sources:
- [src/module-api-surface.ts](${repoBase}/blob/main/src/module-api-surface.ts)
- [scripts/package-entry-manifest.mjs](${repoBase}/blob/main/scripts/package-entry-manifest.mjs)
- [packages/vue/src](${repoBase}/tree/main/packages/vue/src) for the option and state lists

Regenerate this page from the repository root:

\`\`\`bash
pnpm docs:api-surface
\`\`\`

## Nuxt aliases

| Alias | Points to | Use it in |
| ----- | --------- | ------------------ |
| \`#convex/api\` | Your app's \`convex/_generated/api\` | Vue components, composables, route middleware, Nitro server routes, tests |
| \`#convex/server\` | The \`@lupinum/better-convex-nuxt/server\` exports | Nitro server routes and server utilities |
| \`#convex/auth-client\` | The Better Auth client definition from \`convex.auth.client\` | Auth-enabled builds only |

Use \`#convex/api\` for generated Convex functions:

\`\`\`ts
import { api } from '#convex/api'
\`\`\`

Before Convex creates \`convex/_generated/api\`, this alias points to a placeholder. Imports still compile. Reading a function from it throws an error that tells you to run Convex codegen.

## Published package entries

| Import | Runtime exports | Type exports |
| ---------------- | --------------- | ------------ |
${toPackageEntryRows(packageContract)}

Import from \`#convex/server\` when you want an explicit import instead of a Nitro auto-import, or when the export is not auto-imported:

\`\`\`ts
import { requireConvexUser, serverConvex } from '#convex/server'
\`\`\`

Code in your \`convex/\` folder imports the Better Auth helpers, such as \`createUserProjectionTriggers\`, from the \`better-auth/server\` entry:

\`\`\`ts
import { createUserProjectionTriggers } from '@lupinum/better-convex-nuxt/better-auth/server'
\`\`\`

## Core composable auto-imports

Every build auto-imports these composables. When you omit \`convex.auth\`, the module does not install Better Auth, the auth proxy, the auth route middleware, the \`convexAuth\` page metadata, or \`useConvexAuth\`.

| Name | Kind | Purpose | Guide |
| ---- | ---- | ------- | ---------- |
${toRows(composableImports, composableMeta)}

\`useConvexQuery\` options: ${formatList(nuxtQueryOptions)}. It returns ${formatList(queryState)}.

\`useConvexPaginatedQuery\` options: ${formatList(nuxtPaginationOptions)}. \`initialNumItems\` is required and must be a positive integer. It returns ${formatList(paginationState)}. \`status\` and \`pending\` describe the first page only. \`loadMore()\` returns a Promise that never rejects.

In plain Vue, the query options do not include ${formatList(nuxtOnlyQueryOptions, 'or')}.

\`useConvexMutation\` returns ${formatList(mutationReturn)}. \`useConvexAction\` returns ${formatList(actionReturn)}. Destructure the result: \`const { mutate, pending, error } = useConvexMutation(api.notes.create)\`.

## Auth-enabled auto-imports

Authentication is off until you add a \`convex.auth\` object:

\`\`\`ts [nuxt.config.ts]
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  convex: {
    auth: {
      origin: process.env.SITE_URL ?? 'http://localhost:3000',
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
\`\`\`

Only an auth-enabled build auto-imports the API below. To add Better Auth client plugins, define the client with \`defineConvexAuthClient\` from \`@lupinum/better-convex-nuxt/better-auth/client\` and set \`convex.auth.client\` to that file. Use the client through \`useConvexAuth().client\`.

| Name | Kind | Purpose | Guide |
| ---- | ---- | ------- | ---------- |
${toRows(authImports, composableMeta)}

Render auth UI with ordinary Vue conditionals on \`status\`, \`pending\`, and \`error\`. The module does not register auth UI components.

## Server auto-imports

| Name | Kind | Purpose | Guide |
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
