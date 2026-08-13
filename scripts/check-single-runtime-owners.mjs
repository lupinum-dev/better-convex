#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

import { buildEdges } from './check-boundaries.mjs'

const removedClientPaths = ['src/runtime/client-core', 'src/runtime/auth/client-engine.ts']
const removedMcpPaths = [
  'src/runtime/server/mcp',
  'starters/mcp-agent',
  'starters/mcp-oauth-agent/convex/mcp/protocol.ts',
  'starters/mcp-oauth-agent/convex/mcp/security.ts',
]
const forbiddenNuxtMarkers = [
  'packages/vue/src/',
  '@lupinum/better-convex-vue/internal',
  'src/runtime/client-core',
  'attachClientIdentity',
  'createBetterConvexBrowserRuntime',
  'createCallableController',
  'createClientOwner',
  'createPaginationController',
  'createQueryController',
]
const parseableExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.vue'])
const productionRoots = ['src', 'packages', 'starters']
const mcpOwner = 'packages/mcp/src'
const expectedMcpConstructor = 'packages/mcp/src/handler.ts'
const handwrittenProtocolLiterals = new Set([
  'jsonrpc',
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
])

function textFiles(directory) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...textFiles(path))
    else if (entry.isFile() && statSync(path).size <= 5_000_000) files.push(path)
  }
  return files
}

export function findNuxtClientEngineViolations(root, options = {}) {
  const violations = []
  for (const path of removedClientPaths) {
    if (existsSync(resolve(root, path))) violations.push(`removed path exists: ${path}`)
  }

  const scanRoots = [{ label: 'source', path: resolve(root, 'src/runtime') }]
  if (options.dist) scanRoots.push({ label: 'dist', path: resolve(root, 'dist') })

  for (const scanRoot of scanRoots) {
    if (!existsSync(scanRoot.path)) {
      violations.push(`${scanRoot.label} root is missing: ${relative(root, scanRoot.path)}`)
      continue
    }
    for (const file of textFiles(scanRoot.path)) {
      let contents
      try {
        contents = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const repositoryPath = relative(root, file).split(sep).join('/')
      for (const marker of forbiddenNuxtMarkers) {
        if (contents.includes(marker)) violations.push(`${repositoryPath}: forbidden ${marker}`)
      }
    }
  }
  return violations
}

function repositoryPath(root, file) {
  return relative(root, file).split(sep).join('/')
}

function isInside(path, directory) {
  return path === directory || path.startsWith(`${directory}/`)
}

function collectProductionFiles(root) {
  return productionRoots.flatMap((directory) =>
    textFiles(resolve(root, directory)).filter(
      (file) =>
        parseableExtensions.has(extname(file)) &&
        !repositoryPath(root, file).split('/').includes('dist'),
    ),
  )
}

function vueScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script(?:\s[^>]*)?>/giu)].map(
    (match) => match[1],
  )
}

function sourceFragments(file) {
  const source = readFileSync(file, 'utf8')
  return extname(file) === '.vue' ? vueScripts(source) : [source]
}

function inspectSyntax(file) {
  let constructors = 0
  const literals = []
  for (const source of sourceFragments(file)) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'McpServer'
      ) {
        constructors += 1
      }
      if (ts.isStringLiteralLike(node)) literals.push(node.text)
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return { constructors, literals }
}

function findMcpSourceOwnerViolations(root) {
  const violations = []
  for (const path of removedMcpPaths) {
    if (existsSync(resolve(root, path))) violations.push(`removed path exists: ${path}`)
  }

  let constructorCount = 0
  for (const file of collectProductionFiles(root)) {
    const path = repositoryPath(root, file)
    const insideOwner = isInside(path, mcpOwner)
    for (const edge of buildEdges(file)) {
      if (
        !edge.isTypeOnly &&
        (edge.specifier === '@modelcontextprotocol/server' ||
          edge.specifier.startsWith('@modelcontextprotocol/server/')) &&
        !insideOwner
      ) {
        violations.push(`${path}: MCP server runtime import outside ${mcpOwner}`)
      }
    }

    const syntax = inspectSyntax(file)
    if (syntax.constructors > 0) {
      constructorCount += syntax.constructors
      if (path !== expectedMcpConstructor) {
        violations.push(`${path}: McpServer construction outside ${expectedMcpConstructor}`)
      }
    }

    if (path.toLowerCase().includes('mcp') && !insideOwner) {
      for (const literal of syntax.literals) {
        if (handwrittenProtocolLiterals.has(literal)) {
          violations.push(`${path}: hand-written MCP protocol literal ${JSON.stringify(literal)}`)
        }
      }
    }
  }

  if (constructorCount !== 1) {
    violations.push(`expected exactly one McpServer construction, found ${constructorCount}`)
  }
  return violations
}

function findBuiltOwnerViolations(root) {
  const violations = []
  const mcpDist = resolve(root, 'packages/mcp/dist/index.mjs')
  const vueDist = resolve(root, 'packages/vue/dist/index.mjs')
  for (const file of [mcpDist, vueDist]) {
    if (!existsSync(file)) {
      violations.push(`dist owner is missing: ${repositoryPath(root, file)}`)
    }
  }
  if (!existsSync(mcpDist)) return violations

  const mcpBundle = readFileSync(mcpDist, 'utf8')
  const constructorCount = [...mcpBundle.matchAll(/\bnew\s+McpServer\s*\(/gu)].length
  if (!mcpBundle.includes("from '@modelcontextprotocol/server'")) {
    violations.push('packages/mcp/dist/index.mjs: official MCP server import is missing')
  }
  if (constructorCount !== 1) {
    violations.push(
      `packages/mcp/dist/index.mjs: expected exactly one McpServer construction, found ${constructorCount}`,
    )
  }
  for (const path of textFiles(resolve(root, 'dist'))) {
    let source
    try {
      source = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (source.includes('@modelcontextprotocol/server') || /\bnew\s+McpServer\s*\(/u.test(source)) {
      violations.push(
        `${repositoryPath(root, path)}: MCP server implementation leaked into Nuxt dist`,
      )
    }
  }
  return violations
}

export function findSingleRuntimeOwnerViolations(root, options = {}) {
  return [
    ...findNuxtClientEngineViolations(root, options),
    ...findMcpSourceOwnerViolations(root),
    ...(options.dist ? findBuiltOwnerViolations(root) : []),
  ]
}

export function runSingleRuntimeOwnerCheck(root, options = {}) {
  const violations = findSingleRuntimeOwnerViolations(root, options)
  if (violations.length > 0) {
    throw new Error(
      `Single runtime-owner check failed (${violations.length} violation(s)):\n${violations.map((value) => `- ${value}`).join('\n')}`,
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (
    args.some((argument) => argument !== '--dist') ||
    args.filter((v) => v === '--dist').length > 1
  ) {
    throw new Error('Usage: check-single-runtime-owners.mjs [--dist]')
  }
  runSingleRuntimeOwnerCheck(process.cwd(), { dist: args.includes('--dist') })
  console.log(
    `Single runtime-owner check passed${args.includes('--dist') ? ' for source and dist' : ''}.`,
  )
}
