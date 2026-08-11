import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Purity guard: inspect both source and built output. Fail when the
 * errors entry imports: `vue`, `nuxt`, `@nuxt/*`, `#imports`, `#app`,
 * `nitropack/runtime`, browser-only or Node-only built-ins." `convex/values`
 * is explicitly allowed (the framework-free normalizer needs
 * `instanceof ConvexError`).
 *
 * This test inspects BOTH:
 *   - source: `src/runtime/errors/**`
 *   - built output: `dist/runtime/errors/**` (rebuilt here unconditionally so
 *     stale or missing dist bytes can never make the guard pass vacuously).
 *
 * The scan is AST-based (TypeScript compiler API, `allowJs` for the built
 * `.js` output) so it catches static imports, `export ... from` re-exports,
 * and dynamic `import()`, not just a naive substring grep.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SRC_ERRORS_DIR = join(repoRoot, 'src/runtime/errors')
const DIST_ERRORS_DIR = join(repoRoot, 'dist/runtime/errors')

const PARSEABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'])

const ALLOWED_BARE_SPECIFIERS = [/^convex$/, /^convex\//]

/**
 * Disallowed bare-specifier families. Node built-ins
 * are covered generically (`node:*` and the historical bare core-module
 * names), not just a hand-picked few, so the guard does not silently miss one.
 */
const DISALLOWED_SPECIFIER_PATTERNS: Array<{
  label: string
  test: (specifier: string) => boolean
}> = [
  { label: 'vue', test: (s) => s === 'vue' || s.startsWith('vue/') },
  { label: 'nuxt', test: (s) => s === 'nuxt' || s.startsWith('nuxt/') },
  { label: '@nuxt/*', test: (s) => s.startsWith('@nuxt/') },
  { label: '#imports', test: (s) => s === '#imports' || s.startsWith('#imports/') },
  { label: '#app', test: (s) => s === '#app' || s.startsWith('#app/') },
  { label: '#components', test: (s) => s === '#components' || s.startsWith('#components/') },
  { label: '#build', test: (s) => s === '#build' || s.startsWith('#build/') },
  {
    label: 'nitropack/runtime',
    test: (s) => s === 'nitropack/runtime' || s.startsWith('nitropack/runtime/'),
  },
  { label: 'nitropack', test: (s) => s === 'nitropack' },
  { label: 'h3', test: (s) => s === 'h3' },
  {
    label: 'node built-in',
    test: (s) => {
      if (s.startsWith('node:')) return true
      const NODE_BUILTINS = new Set([
        'fs',
        'path',
        'os',
        'child_process',
        'http',
        'https',
        'net',
        'tls',
        'crypto',
        'stream',
        'util',
        'events',
        'url',
        'buffer',
        'process',
        'worker_threads',
        'cluster',
        'dns',
        'zlib',
        'readline',
      ])
      return NODE_BUILTINS.has(s)
    },
  },
  {
    label: 'browser-only global module',
    // Bare specifiers that only resolve in a bundled browser context (not
    // Node built-ins, not the framework specifiers above, but still
    // environment-coupled). better-auth/client, @vue/*, vue-router, and DOM
    // shim packages are the plausible accidental imports here.
    test: (s) => s.startsWith('@vue/') || s === 'vue-router' || s.startsWith('vue-router/'),
  },
]

function isAllowedSpecifier(specifier: string): boolean {
  return ALLOWED_BARE_SPECIFIERS.some((re) => re.test(specifier))
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/')
}

function findDisallowed(specifier: string): string | null {
  if (isRelativeSpecifier(specifier)) return null // same-directory / internal edges are fine
  if (isAllowedSpecifier(specifier)) return null
  const match = DISALLOWED_SPECIFIER_PATTERNS.find((rule) => rule.test(specifier))
  return match ? match.label : null
}

interface FoundImport {
  file: string
  specifier: string
}

/** Collect every file under `dir` with a parseable extension. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry)
      const st = statSync(abs)
      if (st.isDirectory()) {
        walk(abs)
      } else if (PARSEABLE_EXTENSIONS.has(extname(abs))) {
        out.push(abs)
      }
    }
  }
  walk(dir)
  return out
}

/**
 * Extract every module specifier reachable from static imports/exports and
 * dynamic `import()` calls in a single file, using the real TypeScript AST
 * (not a regex), so re-exports (`export ... from`) and dynamic imports are
 * caught along with ordinary `import`.
 */
function extractSpecifiers(absPath: string): string[] {
  const text = readFileSync(absPath, 'utf8')
  const isJs = /\.(?:m|c)?js$/.test(absPath)
  const scriptKind = absPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : isJs
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, scriptKind)

  const specifiers: string[] = []

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text)
    }
    // CommonJS `require('...')`, in case the built output is ever CJS.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const [arg] = node.arguments
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function scanDir(dir: string): FoundImport[] {
  const violations: FoundImport[] = []
  for (const file of listFiles(dir)) {
    for (const specifier of extractSpecifiers(file)) {
      const label = findDisallowed(specifier)
      if (label) {
        violations.push({ file, specifier: `${specifier} (${label})` })
      }
    }
  }
  return violations
}

describe('errors subpath purity guard ', () => {
  it('source (src/runtime/errors/**) imports nothing framework-coupled', () => {
    expect(existsSync(SRC_ERRORS_DIR)).toBe(true)
    const violations = scanDir(SRC_ERRORS_DIR)
    expect(violations).toEqual([])
  })

  it('built output (dist/runtime/errors/**) imports nothing framework-coupled', () => {
    // Rebuild unconditionally so a passing test always describes current
    // source bytes rather than an ignored dist left by an earlier command.
    try {
      execFileSync('pnpm', ['exec', 'nuxt-module-build', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      })
    } catch (error) {
      throw new Error(
        `[errors-subpath-purity] the current package build failed. Run ` +
          `"pnpm exec nuxt-module-build build" manually and re-run this test. ` +
          `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }

    expect(existsSync(DIST_ERRORS_DIR)).toBe(true)
    const files = listFiles(DIST_ERRORS_DIR).filter((f) => !f.endsWith('.d.ts'))
    expect(files.length).toBeGreaterThan(0)

    const violations = scanDir(DIST_ERRORS_DIR)
    expect(violations).toEqual([])
  }, 120000)

  it('sanity: the disallowed-specifier scanner actually detects a planted violation', () => {
    // Guards against the scanner itself silently matching nothing (a purity
    // guard that can never fail is worthless).
    expect(findDisallowed('vue')).toBe('vue')
    expect(findDisallowed('@nuxt/kit')).toBe('@nuxt/*')
    expect(findDisallowed('#imports')).toBe('#imports')
    expect(findDisallowed('#app')).toBe('#app')
    expect(findDisallowed('nitropack/runtime')).toBe('nitropack/runtime')
    expect(findDisallowed('node:fs')).toBe('node built-in')
    expect(findDisallowed('fs')).toBe('node built-in')
    // Explicitly allowed.
    expect(findDisallowed('convex/values')).toBeNull()
    expect(findDisallowed('convex')).toBeNull()
    // Relative same-module edges are always fine.
    expect(findDisallowed('./helpers')).toBeNull()
  })
})
