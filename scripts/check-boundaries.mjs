#!/usr/bin/env node
/**
 * AST-based dependency-direction gate (architecture invariant).
 *
 * Uses the repository's installed `typescript` parser (no new dependency) to
 * build a real import/export edge graph — static imports, dynamic `import()`,
 * and `export ... from` — and checks it against a declarative edge table.
 * Type-only imports/exports (`import type`, per-specifier `type`, and
 * `import('mod').Foo` type positions) are tracked separately from value
 * edges because they cannot introduce runtime coupling.
 *
 * This script enforces current architecture: who may depend on whom. Every
 * rule in the table runs on every invocation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const p = (...segments) => resolve(repoRoot, ...segments)

/** Directory names never walked into, anywhere in the tree. */
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.nuxt',
  '.output',
  '.convex',
  '.cache',
  '.temp',
  '.tmp',
  '.data',
  '.turbo',
  '.idea',
  '.vscode',
  'dist',
  'coverage',
  'reports',
])

const PARSEABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.vue'])

// ---------------------------------------------------------------------------
// Path groups referenced by the edge table.
// ---------------------------------------------------------------------------

/** `src/runtime/server/**` — Nitro/Node-only server runtime. */
const SERVER_RUNTIME_DIR = p('src/runtime/server')

/**
 * Browser runtime: composables, route middleware, and the
 * client-only auth engine/plugin. `plugin.server.ts` is intentionally
 * excluded — it is a distinct SSR-entry group (see below): Nuxt's
 * `.server.ts` suffix means it never ships to the browser bundle, and it is
 * the documented bridge that reads server-side auth/token state during SSR.
 */
const BROWSER_RUNTIME_DIRS = [
  p('src/runtime/composables'),
  p('src/runtime/middleware'),
  p('src/runtime/auth'),
]
const BROWSER_RUNTIME_FILES = [p('src/runtime/plugin.client.ts')]
if (existsSync(p('src/runtime/plugin.auth.client.ts'))) {
  BROWSER_RUNTIME_FILES.push(p('src/runtime/plugin.auth.client.ts'))
}

/**
 * SSR-entry group: runs only in the Nitro/Node SSR pass, never in the
 * browser. Documented, deliberate exception — it is the one browser-runtime
 * sibling allowed to import `src/runtime/server/**` today.
 */
const SSR_ENTRY_FILES = [p('src/runtime/plugin.server.ts')]

/** `src/module*.ts` — module/build code, never a runtime dependency. */
const MODULE_BUILD_FILES = readdirSync(p('src'))
  .filter((name) => /^module.*\.ts$/.test(name) && statSync(p('src', name)).isFile())
  .map((name) => p('src', name))

const RUNTIME_ROOT = p('src/runtime')

/** Public framework-boundary implementation roots. */
const ERRORS_DIR = p('packages/vue/src/errors.ts')
const AUTH_CLIENT_DIR = p('src/runtime/auth-client')
const CONVEX_AUTH_DIR = p('src/runtime/convex-auth')
const CLIENT_LIFECYCLE_DIR = p('packages/vue/src')
const MCP_APP_ENTRY = p('packages/mcp/src/vue.ts')
const MCP_PACKAGE_DIR = p('packages/mcp/src')
const SHARED_AUTH_COOKIE_FILE = p('src/runtime/shared/auth-cookie.ts')
const SHARED_AUTH_ORIGIN_FILE = p('src/runtime/shared/auth-origin.ts')
const SHARED_BOUNDED_STREAM_FILE = p('src/runtime/shared/bounded-stream.ts')
const SHARED_CLIENT_IP_FILE = p('src/runtime/shared/client-ip.ts')

function inDir(absPath, dirAbs) {
  return absPath === dirAbs || absPath.startsWith(dirAbs + sep)
}
function inAnyDir(absPath, dirs) {
  return dirs.some((dir) => inDir(absPath, dir))
}
function isAnyFile(absPath, files) {
  return files.includes(absPath)
}

const isServerRuntime = (absPath) => inDir(absPath, SERVER_RUNTIME_DIR)
const isBrowserRuntime = (absPath) =>
  inAnyDir(absPath, BROWSER_RUNTIME_DIRS) || isAnyFile(absPath, BROWSER_RUNTIME_FILES)
const isModuleBuild = (absPath) => isAnyFile(absPath, MODULE_BUILD_FILES)
const isRuntimeEntry = (absPath) => inDir(absPath, RUNTIME_ROOT)
const isConvexAuth = (absPath) => inDir(absPath, CONVEX_AUTH_DIR)
const isClientLifecycle = (absPath) => inDir(absPath, CLIENT_LIFECYCLE_DIR)
const isMcpPackage = (absPath) => inDir(absPath, MCP_PACKAGE_DIR)
const isSharedAuthCookie = (absPath) => absPath === SHARED_AUTH_COOKIE_FILE
const isSharedAuthOrigin = (absPath) => absPath === SHARED_AUTH_ORIGIN_FILE
const isSharedBoundedStream = (absPath) => absPath === SHARED_BOUNDED_STREAM_FILE
const isSharedClientIp = (absPath) => absPath === SHARED_CLIENT_IP_FILE
const isConvexAuthSharedLeaf = (absPath) =>
  isSharedAuthCookie(absPath) ||
  isSharedAuthOrigin(absPath) ||
  isSharedBoundedStream(absPath) ||
  isSharedClientIp(absPath)

/**
 * Bare-specifier families that only make sense in a browser/Nuxt-app context.
 * `#imports` is deliberately excluded: it is a per-context virtual module
 * (app auto-imports in the browser/SSR-app tsconfig, Nitro auto-imports in
 * `src/runtime/server/tsconfig.json`), so the same specifier text resolves
 * to different, legitimate things depending on which program compiles it.
 */
const BROWSER_ONLY_BARE_SPECIFIERS = [
  /^vue$/,
  /^@vue\//,
  /^vue-router$/,
  /^#app\b/,
  /^#components\b/,
  /^#build\b/,
]
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`),
])
const COMPUTED_DYNAMIC_IMPORT = '<computed dynamic import>'

function isForbiddenConvexAuthBareSpecifier(specifier) {
  return (
    specifier === COMPUTED_DYNAMIC_IMPORT ||
    NODE_BUILTINS.has(specifier) ||
    specifier.startsWith('node:') ||
    specifier.startsWith('#') ||
    specifier.startsWith('~/') ||
    specifier.startsWith('~~/') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('@@/') ||
    specifier.startsWith('$app') ||
    specifier.startsWith('$lib') ||
    specifier === 'convex/browser' ||
    specifier === '@lupinum/better-convex-nuxt' ||
    specifier.startsWith('@lupinum/better-convex-nuxt/') ||
    specifier === 'vue' ||
    specifier.startsWith('@vue/') ||
    specifier === 'vue-router' ||
    specifier === 'nuxt' ||
    specifier.startsWith('@nuxt/') ||
    specifier === 'nitropack' ||
    specifier.startsWith('nitropack/') ||
    specifier === 'h3'
  )
}

function isAllowedClientLifecycleBareSpecifier(specifier) {
  return (
    specifier === 'vue' ||
    specifier === 'convex/browser' ||
    specifier === 'convex/server' ||
    specifier === 'convex/values' ||
    specifier === '@standard-schema/spec' ||
    specifier === 'ohash'
  )
}

function isAllowedVueEntryBareSpecifier(_absPath, specifier) {
  return isAllowedClientLifecycleBareSpecifier(specifier)
}

function isAllowedMcpBareSpecifier(absPath, specifier) {
  return (
    specifier === '@modelcontextprotocol/server' ||
    specifier.startsWith('@modelcontextprotocol/server/') ||
    (absPath === MCP_APP_ENTRY &&
      (specifier === '@modelcontextprotocol/ext-apps' || specifier === 'vue'))
  )
}

// ---------------------------------------------------------------------------
// Edge table (architecture invariant)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Rule
 * @property {string} name - short rule identifier
 * @property {string} description - human-readable summary shown on failure
 * @property {(absPath: string) => boolean} from - files this rule inspects
 * @property {(edge: Edge) => boolean} disallow - true if the edge is forbidden
 * @property {boolean} [typeOnlyExempt] - if true (default), a type-only edge that would
 *   otherwise match `disallow` is allowed because it cannot introduce runtime coupling.
 * @typedef {object} Edge
 * @property {string} fromAbsPath - absolute importer path
 * @property {boolean} isRelative - whether the specifier is a relative path (`./`, `../`)
 * @property {string|null} resolvedAbsPath - resolved file, if relative and it exists
 * @property {string} specifier - raw module specifier text
 * @property {boolean} isTypeOnly - whether the edge is type-only (no runtime coupling)
 */

/** @type {Rule[]} */
const RULES = [
  {
    name: 'mcp-package-official-sdk-only',
    description:
      'packages/mcp/src/** may import only its own package and the exact official MCP server SDK; Nuxt, Nitro, H3, Better Auth, Vue, Node built-ins, aliases, and sibling workspace packages are forbidden.',
    from: isMcpPackage,
    disallow: (edge) => {
      if (!edge.isRelative) return !isAllowedMcpBareSpecifier(edge.fromAbsPath, edge.specifier)
      if (edge.resolvedAbsPath === null) return false
      return !isMcpPackage(edge.resolvedAbsPath)
    },
    typeOnlyExempt: false,
  },
  {
    name: 'client-lifecycle-island-browser-only',
    description:
      'packages/vue/src/** may import only its own package, Vue, ohash, Standard Schema types, and reviewed Convex browser/value/type entries. Nuxt, Nitro, H3, Better Auth, MCP, aliases, and Node built-ins are forbidden.',
    from: isClientLifecycle,
    disallow: (edge) => {
      if (!edge.isRelative) {
        return !isAllowedVueEntryBareSpecifier(edge.fromAbsPath, edge.specifier)
      }
      if (edge.resolvedAbsPath === null) return false
      return !isClientLifecycle(edge.resolvedAbsPath) && !inDir(edge.resolvedAbsPath, ERRORS_DIR)
    },
    typeOnlyExempt: false,
  },
  {
    name: 'convex-auth-island-framework-free',
    description:
      'src/runtime/convex-auth/** may import only its own island, the approved dependency-free shared leaves, and edge-compatible packages; Nuxt, Vue, Nitro, H3, aliases, Node built-ins, browser runtime, server runtime, and module code are forbidden.',
    from: isConvexAuth,
    disallow: (edge) => {
      if (!edge.isRelative) return isForbiddenConvexAuthBareSpecifier(edge.specifier)
      if (edge.resolvedAbsPath === null) return false
      return !isConvexAuth(edge.resolvedAbsPath) && !isConvexAuthSharedLeaf(edge.resolvedAbsPath)
    },
    typeOnlyExempt: false,
  },
  {
    name: 'shared-auth-cookie-dependency-free',
    description:
      'src/runtime/shared/auth-cookie.ts is a dependency-free cookie boundary shared by Nuxt and Convex auth code.',
    from: isSharedAuthCookie,
    disallow: () => true,
    typeOnlyExempt: false,
  },
  {
    name: 'shared-auth-origin-dependency-free',
    description:
      'src/runtime/shared/auth-origin.ts is a dependency-free leaf shared by Nuxt and Convex auth code.',
    from: isSharedAuthOrigin,
    disallow: () => true,
    typeOnlyExempt: false,
  },
  {
    name: 'shared-bounded-stream-dependency-free',
    description:
      'src/runtime/shared/bounded-stream.ts is a dependency-free Web Streams leaf shared by Nitro and Convex auth code.',
    from: isSharedBoundedStream,
    disallow: () => true,
    typeOnlyExempt: false,
  },
  {
    name: 'shared-client-ip-dependency-free',
    description:
      'src/runtime/shared/client-ip.ts is a dependency-free Web Crypto leaf shared by Nitro and Convex auth code.',
    from: isSharedClientIp,
    disallow: () => true,
    typeOnlyExempt: false,
  },
  {
    name: 'module-no-convex-auth-imports',
    description:
      'Nuxt module/build code must not import or re-export the Convex auth backend island.',
    from: isModuleBuild,
    disallow: (edge) =>
      (edge.isRelative && edge.resolvedAbsPath !== null && isConvexAuth(edge.resolvedAbsPath)) ||
      (!edge.isRelative &&
        edge.specifier.startsWith('@lupinum/better-convex-nuxt/better-auth/server')),
    typeOnlyExempt: false,
  },
  {
    name: 'browser-no-convex-auth-imports',
    description:
      'Browser runtime and the public auth-client definition must not import or re-export the Convex auth backend island.',
    from: (absPath) => isBrowserRuntime(absPath) || inDir(absPath, AUTH_CLIENT_DIR),
    disallow: (edge) =>
      (edge.isRelative && edge.resolvedAbsPath !== null && isConvexAuth(edge.resolvedAbsPath)) ||
      (!edge.isRelative &&
        edge.specifier.startsWith('@lupinum/better-convex-nuxt/better-auth/server')),
    typeOnlyExempt: false,
  },
  {
    name: 'server-no-browser-imports',
    description:
      'src/runtime/server/** must never import composables, middleware, the auth engine, Vue, or the client plugin.',
    from: isServerRuntime,
    disallow: (edge) => {
      if (edge.isRelative) {
        return edge.resolvedAbsPath !== null && isBrowserRuntime(edge.resolvedAbsPath)
      }
      return BROWSER_ONLY_BARE_SPECIFIERS.some((re) => re.test(edge.specifier))
    },
  },
  {
    name: 'browser-no-server-imports',
    description:
      'Browser runtime (composables, middleware, auth engine, client plugin) must never import src/runtime/server/**.',
    from: (absPath) => isBrowserRuntime(absPath),
    disallow: (edge) =>
      edge.isRelative && edge.resolvedAbsPath !== null && isServerRuntime(edge.resolvedAbsPath),
  },
  {
    name: 'module-no-runtime-leak',
    description:
      'src/runtime/** must never import src/module*.ts (module/build code leaking into runtime entries).',
    from: isRuntimeEntry,
    disallow: (edge) =>
      edge.isRelative && edge.resolvedAbsPath !== null && isModuleBuild(edge.resolvedAbsPath),
    typeOnlyExempt: false,
  },

  {
    name: 'errors-framework-free',
    description:
      '/errors implementation must import only its own framework-free code, platform-neutral language primitives, and the public Convex error-value entry.',
    from: (absPath) => inDir(absPath, ERRORS_DIR),
    disallow: (edge) => {
      if (!edge.isRelative) {
        return edge.specifier !== 'convex' && !edge.specifier.startsWith('convex/')
      }
      return edge.resolvedAbsPath !== null && !inDir(edge.resolvedAbsPath, ERRORS_DIR)
    },
  },
  {
    name: 'auth-client-no-runtime-deps',
    description:
      '/auth-client implementation must import no runtime dependency; type-only Better Auth imports are allowed, Nuxt/#app/Vue/Nitro/Node-only/server-runtime are forbidden.',
    from: (absPath) => inDir(absPath, AUTH_CLIENT_DIR),
    disallow: (edge) => {
      if (edge.isRelative) {
        return edge.resolvedAbsPath !== null && isServerRuntime(edge.resolvedAbsPath)
      }
      return (
        BROWSER_ONLY_BARE_SPECIFIERS.some((re) => re.test(edge.specifier)) ||
        edge.specifier.startsWith('node:') ||
        edge.specifier === 'nitropack' ||
        edge.specifier.startsWith('nitropack/')
      )
    },
  },
]

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function collectFiles(absoluteRoot) {
  const files = []
  const stack = [absoluteRoot]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
        stack.push(join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!PARSEABLE_EXTENSIONS.has(extname(entry.name))) continue
      files.push(join(dir, entry.name))
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// Workspace package ownership
// ---------------------------------------------------------------------------

const DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'devDependencies',
]

function readJsonFile(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8'))
}

/**
 * Read the deliberately small workspace grammar used by this repository.
 * Supporting arbitrary globs here would make package ownership permissive;
 * new shapes must instead be reviewed and added explicitly.
 */
function readWorkspacePatterns(absoluteWorkspaceFile) {
  const source = readFileSync(absoluteWorkspaceFile, 'utf8')
  const lines = source.split(/\r?\n/u)
  const packagesLine = lines.findIndex((line) => /^packages:\s*(?:#.*)?$/u.test(line))
  if (packagesLine === -1) throw new Error('pnpm-workspace.yaml has no packages block.')

  const patterns = []
  for (const line of lines.slice(packagesLine + 1)) {
    if (/^\S/u.test(line)) break
    const item = line.trim()
    if (!item.startsWith('- ')) continue
    const unquoted = item.slice(2).split('#', 1)[0].trim()
    const pattern =
      (unquoted.startsWith("'") && unquoted.endsWith("'")) ||
      (unquoted.startsWith('"') && unquoted.endsWith('"'))
        ? unquoted.slice(1, -1)
        : unquoted
    if (
      pattern.length === 0 ||
      pattern.startsWith('!') ||
      (pattern.includes('*') && !pattern.endsWith('/*')) ||
      /[?{}[\]]/u.test(pattern)
    ) {
      throw new Error(`Unsupported workspace package pattern: ${pattern}`)
    }
    patterns.push(pattern)
  }
  if (patterns.length === 0) throw new Error('pnpm-workspace.yaml packages block is empty.')
  return patterns
}

function expandWorkspacePattern(root, pattern) {
  if (!pattern.endsWith('/*')) return [resolve(root, pattern)]
  const parent = resolve(root, pattern.slice(0, -2))
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name))
}

function discoverWorkspacePackages(root = repoRoot) {
  const directories = [
    root,
    ...readWorkspacePatterns(join(root, 'pnpm-workspace.yaml')).flatMap((pattern) =>
      expandWorkspacePattern(root, pattern),
    ),
  ]

  const packages = []
  const names = new Set()
  for (const directory of new Set(directories)) {
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readJsonFile(manifestPath)
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${relative(root, manifestPath)} must declare a package name.`)
    }
    if (names.has(manifest.name)) {
      throw new Error(`Duplicate workspace package name: ${manifest.name}`)
    }
    names.add(manifest.name)
    packages.push({
      directory: resolve(directory),
      manifest,
      name: manifest.name,
    })
  }
  return packages.sort((left, right) => right.directory.length - left.directory.length)
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function owningPackage(absolutePath, packages) {
  return (
    packages.find((workspacePackage) => inDir(absolutePath, workspacePackage.directory)) ?? null
  )
}

function declaredDependencyNames(manifest) {
  return new Set(
    DEPENDENCY_FIELDS.flatMap((field) =>
      manifest[field] && typeof manifest[field] === 'object' ? Object.keys(manifest[field]) : [],
    ),
  )
}

function findWorkspaceDependencyCycles(packages) {
  const packageByName = new Map(
    packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  )
  const dependencies = new Map(
    packages.map((workspacePackage) => [
      workspacePackage.name,
      [...declaredDependencyNames(workspacePackage.manifest)].filter((name) =>
        packageByName.has(name),
      ),
    ]),
  )
  const visited = new Set()
  const active = new Set()
  const stack = []
  const cycles = []

  function visit(name) {
    if (active.has(name)) {
      const start = stack.indexOf(name)
      cycles.push([...stack.slice(start), name])
      return
    }
    if (visited.has(name)) return
    active.add(name)
    stack.push(name)
    for (const dependency of dependencies.get(name) ?? []) visit(dependency)
    stack.pop()
    active.delete(name)
    visited.add(name)
  }

  for (const workspacePackage of packages) visit(workspacePackage.name)
  return cycles
}

function findWorkspaceDependencyViolations(files, packages) {
  const packageByName = new Map(
    packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  )
  const violations = []

  for (const absoluteFile of files) {
    const importer = owningPackage(absoluteFile, packages)
    if (!importer) continue
    const declared = declaredDependencyNames(importer.manifest)
    for (const edge of buildEdges(absoluteFile)) {
      if (edge.isRelative && edge.resolvedAbsPath !== null) {
        const target = owningPackage(edge.resolvedAbsPath, packages)
        if (target && target !== importer) {
          violations.push({
            file: absoluteFile,
            kind: 'relative-cross-package',
            message: `relative import crosses from ${importer.name} into ${target.name}`,
            specifier: edge.specifier,
          })
        }
        continue
      }
      if (edge.isRelative || edge.specifier === COMPUTED_DYNAMIC_IMPORT) continue
      const targetName = packageNameFromSpecifier(edge.specifier)
      if (targetName === importer.name || !packageByName.has(targetName)) continue
      if (!declared.has(targetName)) {
        violations.push({
          file: absoluteFile,
          kind: 'undeclared-workspace-import',
          message: `${importer.name} imports workspace package ${targetName} without declaring it`,
          specifier: edge.specifier,
        })
      }
    }
  }

  for (const cycle of findWorkspaceDependencyCycles(packages)) {
    violations.push({
      file: null,
      kind: 'workspace-dependency-cycle',
      message: `workspace dependency cycle: ${cycle.join(' -> ')}`,
      specifier: cycle.join(' -> '),
    })
  }
  return violations
}

// ---------------------------------------------------------------------------
// AST edge extraction
// ---------------------------------------------------------------------------

/** Extract `<script ...>...</script>` block contents (there may be two: normal + setup). */
function extractVueScriptBlocks(source) {
  const lowerSource = source.toLowerCase()
  const blocks = []
  let offset = 0
  const findTag = (tag, from) => {
    let index = lowerSource.indexOf(tag, from)
    while (index !== -1) {
      const next = lowerSource[index + tag.length]
      if (next === '>' || ' \t\r\n\f'.includes(next)) return index
      index = lowerSource.indexOf(tag, index + tag.length)
    }
    return -1
  }

  while (offset < source.length) {
    const open = findTag('<script', offset)
    if (open === -1) break

    const openEnd = lowerSource.indexOf('>', open + 7)
    if (openEnd === -1) break

    const close = findTag('</script', openEnd + 1)
    if (close === -1) break

    const closeEnd = lowerSource.indexOf('>', close + 8)
    if (closeEnd === -1) break

    blocks.push(source.slice(openEnd + 1, close))
    offset = closeEnd + 1
  }

  return blocks
}

function tryResolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  const emittedExtensionBase = /\.(?:c|m)?js$/u.test(base)
    ? base.replace(/\.(?:c|m)?js$/u, '')
    : null
  const candidates = [
    base,
    ...(emittedExtensionBase
      ? [
          `${emittedExtensionBase}.ts`,
          `${emittedExtensionBase}.tsx`,
          `${emittedExtensionBase}.mts`,
          `${emittedExtensionBase}.cts`,
          `${emittedExtensionBase}.d.ts`,
        ]
      : []),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.d.ts`,
    `${base}.vue`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.vue'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Collect import/export/dynamic-import edges from one TS source text. */
function collectEdgesFromSource(fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  /** @type {{ specifier: string, isTypeOnly: boolean }[]} */
  const raw = []

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause
      let isTypeOnly = false
      if (clause) {
        if (clause.isTypeOnly) {
          isTypeOnly = true
        } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const elements = clause.namedBindings.elements
          isTypeOnly = elements.length > 0 && elements.every((el) => el.isTypeOnly)
        }
      }
      raw.push({ specifier: node.moduleSpecifier.text, isTypeOnly })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      let isTypeOnly = node.isTypeOnly
      if (!isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
        const elements = node.exportClause.elements
        isTypeOnly = elements.length > 0 && elements.every((el) => el.isTypeOnly)
      }
      raw.push({ specifier: node.moduleSpecifier.text, isTypeOnly })
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      // Dynamic `import(...)` always introduces a real runtime edge.
      raw.push({
        specifier: ts.isStringLiteral(node.arguments[0])
          ? node.arguments[0].text
          : COMPUTED_DYNAMIC_IMPORT,
        isTypeOnly: false,
      })
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      // `import('mod').Foo` used purely as a type — never a runtime edge.
      raw.push({ specifier: node.argument.literal.text, isTypeOnly: true })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return raw
}

function buildEdges(absoluteFile) {
  const text = readFileSync(absoluteFile, 'utf8')
  const isVue = extname(absoluteFile) === '.vue'
  const rawEdges = isVue
    ? extractVueScriptBlocks(text).flatMap((block) => collectEdgesFromSource(absoluteFile, block))
    : collectEdgesFromSource(absoluteFile, text)

  return rawEdges.map(({ specifier, isTypeOnly }) => {
    const isRelative = specifier.startsWith('.')
    const resolvedAbsPath = isRelative ? tryResolveRelative(absoluteFile, specifier) : null
    return {
      fromAbsPath: absoluteFile,
      isRelative,
      resolvedAbsPath,
      specifier,
      isTypeOnly,
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Path-group constants documented as existing today; catches config rot if a file moves. */
function assertKnownPathsExist() {
  const knownFiles = [...BROWSER_RUNTIME_FILES, ...SSR_ENTRY_FILES, ...MODULE_BUILD_FILES]
  const knownDirs = [SERVER_RUNTIME_DIR, ...BROWSER_RUNTIME_DIRS, RUNTIME_ROOT]
  for (const file of knownFiles) {
    if (!existsSync(file)) {
      throw new Error(
        `boundary checker misconfigured: expected file does not exist: ${relative(repoRoot, file)}`,
      )
    }
  }
  for (const dir of knownDirs) {
    if (!existsSync(dir)) {
      throw new Error(
        `boundary checker misconfigured: expected directory does not exist: ${relative(repoRoot, dir)}`,
      )
    }
  }
}

function main() {
  assertKnownPathsExist()

  const workspacePackages = discoverWorkspacePackages()
  const files = [
    ...new Set([
      ...collectFiles(p('src')),
      ...workspacePackages
        .filter((workspacePackage) => workspacePackage.directory !== repoRoot)
        .flatMap((workspacePackage) => collectFiles(workspacePackage.directory)),
    ]),
  ]

  /** @type {{ rule: Rule, file: string, specifier: string, isTypeOnly: boolean }[]} */
  const violations = []

  for (const absoluteFile of files) {
    let edges
    try {
      edges = buildEdges(absoluteFile)
    } catch (error) {
      console.error(
        `✗ boundary checker failed to parse ${relative(repoRoot, absoluteFile)}: ${error.message}`,
      )
      process.exit(1)
    }

    for (const rule of RULES) {
      if (!rule.from(absoluteFile)) continue
      const typeOnlyExempt = rule.typeOnlyExempt !== false
      for (const edge of edges) {
        if (edge.isTypeOnly && typeOnlyExempt) continue
        if (rule.disallow(edge)) {
          violations.push({
            rule,
            file: absoluteFile,
            specifier: edge.specifier,
            isTypeOnly: edge.isTypeOnly,
          })
        }
      }
    }
  }

  if (violations.length > 0) {
    const byRule = new Map()
    for (const violation of violations) {
      if (!byRule.has(violation.rule.name)) byRule.set(violation.rule.name, [])
      byRule.get(violation.rule.name).push(violation)
    }
    for (const [ruleName, ruleViolations] of byRule) {
      console.error(`\n✗ ${ruleName}: ${ruleViolations[0].rule.description}`)
      for (const violation of ruleViolations) {
        console.error(`  ${relative(repoRoot, violation.file)} -> "${violation.specifier}"`)
      }
    }
    console.error(
      `\nboundary check failed: ${violations.length} forbidden edge(s) across ${byRule.size} rule(s).`,
    )
    process.exit(1)
  }

  const workspaceViolations = findWorkspaceDependencyViolations(files, workspacePackages)
  if (workspaceViolations.length > 0) {
    console.error(
      '\n✗ workspace-package-direction: package edges must use declared public imports and remain acyclic.',
    )
    for (const violation of workspaceViolations) {
      const source = violation.file ? relative(repoRoot, violation.file) : '<package manifests>'
      console.error(`  ${source} -> "${violation.specifier}" (${violation.message})`)
    }
    console.error(
      `\nboundary check failed: ${workspaceViolations.length} workspace package violation(s).`,
    )
    process.exit(1)
  }

  console.log(
    `✓ boundary check passed (${RULES.length} architecture rule(s), ${workspacePackages.length} package(s), ${files.length} file(s) scanned).`,
  )
}

export {
  buildEdges,
  discoverWorkspacePackages,
  findWorkspaceDependencyCycles,
  findWorkspaceDependencyViolations,
  RULES,
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main()
}
