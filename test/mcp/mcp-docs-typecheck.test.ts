import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The MCP pages are copied into applications verbatim, so their Convex modules must compile
 * against the real package exports and the installed official SDK, not only parse. Each page
 * becomes a small virtual Convex project next to the repository's node_modules. Only the files
 * that Convex codegen and the application would own are stubbed: `_generated/*` has the shape
 * Convex writes, and `schema.ts` holds the page's own table definition.
 */
const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const pages = {
  guide: read('docs/content/docs/3.build/7.agents/1.mcp.md'),
  readme: read('packages/mcp/README.md'),
  recipe: read('docs/content/docs/3.build/7.agents/2.mcp-application.md'),
  connect: read('docs/content/docs/3.build/7.agents/3.connect-chatgpt-and-claude.md'),
  apps: read('docs/content/docs/3.build/7.agents/4.mcp-apps.md'),
  upgrade: read('docs/content/docs/6.operations/7.upgrade-to-1-0.md'),
}
const upgradeMcpSection = pages.upgrade.slice(
  pages.upgrade.search(/^## \d+\. Update the MCP server$/m),
  pages.upgrade.indexOf('## New options you can use'),
)

/** Every fenced block labelled `[label]`, dedented when the fence sits inside a list item. */
function blocks(source: string, label: string, language = 'ts'): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const fence = new RegExp(
    `^( *)\`\`\`${language} \\[${escaped}\\]\\n([\\s\\S]*?)^\\1\`\`\`$`,
    'gmu',
  )
  return [...source.matchAll(fence)].map(([, indent, body]) =>
    body!
      .split('\n')
      .map((line) => line.slice(indent!.length))
      .join('\n'),
  )
}

function block(source: string, label: string, language = 'ts'): string {
  const found = blocks(source, label, language)
  if (found.length !== 1) throw new Error(`Expected one [${label}] block, found ${found.length}`)
  return found[0]!
}

const generated = {
  'convex/_generated/dataModel.ts': [
    "import type { DataModelFromSchemaDefinition } from 'convex/server'",
    "import type schema from '../schema'",
    'export type DataModel = DataModelFromSchemaDefinition<typeof schema>',
  ].join('\n'),
  'convex/_generated/server.ts': [
    'import type {',
    '  ActionBuilder, GenericActionCtx, GenericMutationCtx, GenericQueryCtx, HttpActionBuilder,',
    '  MutationBuilder, QueryBuilder,',
    "} from 'convex/server'",
    "import type { DataModel } from './dataModel'",
    "export declare const query: QueryBuilder<DataModel, 'public'>",
    "export declare const internalQuery: QueryBuilder<DataModel, 'internal'>",
    "export declare const mutation: MutationBuilder<DataModel, 'public'>",
    "export declare const internalMutation: MutationBuilder<DataModel, 'internal'>",
    "export declare const action: ActionBuilder<DataModel, 'public'>",
    'export declare const httpAction: HttpActionBuilder',
    'export type QueryCtx = GenericQueryCtx<DataModel>',
    'export type MutationCtx = GenericMutationCtx<DataModel>',
    'export type ActionCtx = GenericActionCtx<DataModel>',
  ].join('\n'),
  'convex/_generated/api.ts': [
    "import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server'",
    "import type { ComponentApi } from '@lupinum/better-convex-nuxt/better-auth/_generated/component.js'",
    "import type * as connections from '../connections'",
    "import type * as notes from '../notes'",
    'declare const fullApi: ApiFromModules<{ connections: typeof connections; notes: typeof notes }>',
    "export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>",
    "export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>",
    "export declare const components: { betterAuth: ComponentApi<'betterAuth'> }",
  ].join('\n'),
}

function schemaModule(tables: string): string {
  return [
    "import { defineSchema, defineTable } from 'convex/server'",
    "import { v } from 'convex/values'",
    'export default defineSchema({',
    tables,
    '})',
  ].join('\n')
}

/** The recipe shows `oauth.mcp` as one property of the application's existing factory call. */
function recipeAuthModule(): string {
  return [
    "import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'",
    "import { components } from './_generated/api'",
    "import type { DataModel } from './_generated/dataModel'",
    "import { MCP_SCOPES } from './mcpScopes'",
    'export const auth = createBetterConvexAuth<DataModel>(components.betterAuth, {',
    block(pages.recipe, 'convex/auth.ts'),
    '})',
  ].join('\n')
}

/** The npm README shows the factory call; the application already has its imports. */
function readmeAuthModule(): string {
  return [
    "import { createBetterConvexAuth } from '@lupinum/better-convex-nuxt/better-auth/server'",
    "import { components } from './_generated/api'",
    "import type { DataModel } from './_generated/dataModel'",
    block(pages.readme, 'convex/auth.ts'),
  ].join('\n')
}

/** The recipe's http.ts adds routes to the application's existing router. */
function recipeHttpModule(): string {
  return [
    "import type { HttpRouter } from 'convex/server'",
    'declare const http: HttpRouter',
    block(pages.recipe, 'convex/http.ts'),
  ].join('\n')
}

/** The Apps page adds module-level constants and registrations inside `registerNoteTools`. */
function appsMcpModule(): string {
  const recipeMcp = block(pages.recipe, 'convex/mcp.ts')
  const apps = block(pages.apps, 'convex/mcp.ts')
  const marker = '// Inside registerNoteTools(ctx, { principal, server, tools }):\n'
  if (!apps.includes(marker)) throw new Error('MCP Apps block lost its registerNoteTools marker')
  const [moduleLevel, inside] = apps.split(marker) as [string, string]
  const imports = moduleLevel.match(/^import[\s\S]*?from '[^']+'\n/gmu)!.join('')
  const constants = moduleLevel.replace(/^import[\s\S]*?from '[^']+'\n/gmu, '')
  const insertAt = recipeMcp.indexOf('\n}\n\nexport const handleMcp')
  if (insertAt < 0) throw new Error('Recipe block lost the end of registerNoteTools')
  const recipeImportsEnd = recipeMcp.indexOf("import { auth } from './auth'\n")
  return [
    recipeMcp.slice(0, recipeImportsEnd),
    imports,
    "import { auth } from './auth'\n",
    constants,
    recipeMcp.slice(recipeImportsEnd + "import { auth } from './auth'\n".length, insertAt),
    inside,
    recipeMcp.slice(insertAt),
  ].join('\n')
}

/** The card's `<script setup>` is plain TypeScript against Vue and the official Apps SDK. */
function notesCardScript(): string {
  const sfc = block(pages.apps, 'mcp-ui/NotesCard.vue', 'vue')
  return sfc.match(/<script setup lang="ts">\n([\s\S]*?)<\/script>/u)![1]!
}

const recipeSchema = schemaModule(block(pages.recipe, 'convex/schema.ts'))

type VirtualProject = Readonly<Record<string, string>>

const samples: Record<string, VirtualProject> = {
  recipe: {
    ...generated,
    'convex/schema.ts': recipeSchema,
    'convex/mcpScopes.ts': block(pages.recipe, 'convex/mcpScopes.ts'),
    'convex/auth.ts': recipeAuthModule(),
    'convex/http.ts': recipeHttpModule(),
    'convex/notes.ts': block(pages.recipe, 'convex/notes.ts'),
    'convex/mcp.ts': block(pages.recipe, 'convex/mcp.ts'),
    // The connect page adds its Inspector client to the recipe's connections module.
    'convex/connections.ts': [
      block(pages.recipe, 'convex/connections.ts'),
      block(pages.connect, 'convex/connections.ts'),
    ].join('\n'),
    // The MCP guide's catalog test imports the recipe's exported registerNoteTools.
    'convex/mcp.test.ts': block(pages.guide, 'convex/mcp.test.ts'),
  },
  // The npm README quick start: complete modules on the recipe's notes table.
  readme: {
    ...generated,
    'convex/schema.ts': recipeSchema,
    'convex/auth.ts': readmeAuthModule(),
    'convex/mcp.ts': block(pages.readme, 'convex/mcp.ts'),
    'convex/notes.ts': block(pages.readme, 'convex/notes.ts'),
    'convex/connections.ts': 'export {}',
  },
  apps: {
    ...generated,
    'convex/schema.ts': recipeSchema,
    'convex/mcpScopes.ts': block(pages.recipe, 'convex/mcpScopes.ts'),
    'convex/auth.ts': recipeAuthModule(),
    'convex/notes.ts': block(pages.recipe, 'convex/notes.ts'),
    'convex/connections.ts': block(pages.recipe, 'convex/connections.ts'),
    'convex/mcp.ts': appsMcpModule(),
    // Written by the page's embed script.
    'convex/mcp/notesCardHtml.ts': 'export const NOTES_CARD_HTML = "<!doctype html>"',
    'mcp-ui/NotesCard.ts': notesCardScript(),
  },
  upgrade: {
    ...generated,
    'convex/schema.ts': recipeSchema,
    'convex/auth.ts': block(upgradeMcpSection, 'convex/auth.ts'),
    'convex/mcp.ts': block(upgradeMcpSection, 'convex/mcp.ts'),
    'convex/notes.ts': block(upgradeMcpSection, 'convex/notes.ts'),
    'convex/connections.ts': 'export {}',
  },
}

function compilerOptions(): ts.CompilerOptions {
  const configPath = join(root, 'test/mcp/tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath))
  return {
    ...parsed.options,
    // Application modules, not test files: no test globals.
    types: ['node'],
    noEmit: true,
    paths: {
      ...parsed.options.paths,
      '@lupinum/better-convex-nuxt/better-auth/_generated/component.js': [
        'src/runtime/convex-auth/component/_generated/component.ts',
      ],
    },
  }
}

/**
 * One program for every sample keeps the shared declaration graph (Better Auth, Convex, the SDK)
 * parsed once. Virtual files sit under an unused directory in the repository, so their bare
 * imports resolve through the same node_modules an application would install.
 */
function typecheckSamples(projects: Record<string, VirtualProject>) {
  const base = join(root, 'test/mcp/.docs-samples')
  const files = new Map<string, string>()
  for (const [name, project] of Object.entries(projects)) {
    for (const [path, source] of Object.entries(project)) {
      files.set(resolve(base, name, path), source)
    }
  }
  const options = compilerOptions()
  const host = ts.createCompilerHost(options, true)
  const isVirtualDirectory = (path: string) => resolve(path).startsWith(base)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const readFile = host.readFile.bind(host)
  const directoryExists = host.directoryExists?.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const source = files.get(resolve(fileName))
    return source === undefined
      ? getSourceFile(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, source, languageVersion, true)
  }
  host.fileExists = (fileName) => files.has(resolve(fileName)) || fileExists(fileName)
  host.readFile = (fileName) => files.get(resolve(fileName)) ?? readFile(fileName)
  host.directoryExists = (path) =>
    isVirtualDirectory(path) || (directoryExists ? directoryExists(path) : true)
  const program = ts.createProgram({
    rootNames: [...files.keys()],
    options,
    host,
  })
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) => diagnostic.file === undefined || files.has(resolve(diagnostic.file.fileName)),
    )
  const byProject: Record<string, string[]> = Object.fromEntries(
    Object.keys(projects).map((name) => [name, []]),
  )
  for (const diagnostic of diagnostics) {
    const fileName = diagnostic.file ? resolve(diagnostic.file.fileName) : base
    const relative = fileName.slice(base.length + 1)
    const [name = '(program)'] = relative.split('/')
    const position =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined
    ;(byProject[name] ??= []).push(
      `${relative}${position ? `:${position.line + 1}` : ''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    )
  }
  return byProject
}

describe('MCP documentation samples typecheck against the real exports', () => {
  let diagnostics: Record<string, string[]>

  beforeAll(() => {
    // The old upgrade-guide tool returned only structuredContent without an outputSchema
    // (TS2322 against McpToolHandlerResult). Keep it as a negative control, so this check can
    // never pass because the program silently stopped seeing the samples.
    const withoutOutputSchema = samples.upgrade!['convex/mcp.ts']!.replace(
      /\n {8}outputSchema: z\.object\(\{[\s\S]*?\n {8}\}\),/u,
      '',
    )
    diagnostics = typecheckSamples({
      ...samples,
      'upgrade-without-output-schema': {
        ...samples.upgrade!,
        'convex/mcp.ts': withoutOutputSchema,
      },
    })
  }, 120_000)

  it.each(['recipe', 'readme', 'apps', 'upgrade'])('compiles the %s sample', (name) => {
    expect(diagnostics[name]).toEqual([])
  })

  it('rejects a tool that returns only structuredContent without an outputSchema', () => {
    expect(samples.upgrade!['convex/mcp.ts']).toContain('outputSchema: z.object({')
    expect(diagnostics['upgrade-without-output-schema']).toEqual([
      expect.stringMatching(/^upgrade-without-output-schema\/convex\/mcp\.ts:\d+ TS2322: /u),
    ])
  })
})

describe('MCP Apps embed script', () => {
  it('creates convex/mcp before it writes the card module', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mcp-apps-embed-'))
    try {
      mkdirSync(join(cwd, 'mcp-ui/dist'), { recursive: true })
      writeFileSync(join(cwd, 'mcp-ui/dist/index.html'), '<!doctype html><p>card</p>')
      mkdirSync(join(cwd, 'scripts'))
      writeFileSync(
        join(cwd, 'scripts/embed-mcp-ui.mjs'),
        block(pages.apps, 'scripts/embed-mcp-ui.mjs', 'js'),
      )
      expect(existsSync(join(cwd, 'convex'))).toBe(false)
      execFileSync(process.execPath, ['scripts/embed-mcp-ui.mjs'], {
        cwd,
        stdio: 'pipe',
      })
      expect(readFileSync(join(cwd, 'convex/mcp/notesCardHtml.ts'), 'utf8')).toBe(
        '// Generated by scripts/embed-mcp-ui.mjs. Do not edit.\n' +
          'export const NOTES_CARD_HTML = "<!doctype html><p>card</p>"\n',
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
