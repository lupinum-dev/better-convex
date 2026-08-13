import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { build, type Rollup } from 'vite'

const emptyZodLocalesModule = '\0better-convex-empty-zod-locales'

export interface NotesDashboardBuild {
  readonly appHtml: string
  readonly appModules: readonly string[]
  readonly hostJavaScript: string
  readonly hostModules: readonly string[]
}

export interface NotesDashboardBuildOptions {
  readonly extAppsBridgeEntry?: string
  readonly extAppsEntry?: string
  readonly mcpAppEntry?: string
}

function outputs(
  value: Rollup.RollupOutput | Rollup.RollupOutput[],
): Array<Rollup.OutputAsset | Rollup.OutputChunk> {
  return (Array.isArray(value) ? value : [value]).flatMap((result) => result.output)
}

async function bundleEntry(
  entry: string,
  options: {
    aliases?: Record<string, string>
    name: string
    vue: boolean
  },
): Promise<{ css: string; javaScript: string; modules: string[] }> {
  const result = await build({
    build: {
      cssCodeSplit: false,
      emptyOutDir: false,
      lib: {
        entry,
        fileName: () => 'entry.js',
        formats: ['iife'],
        name: options.name,
      },
      minify: 'esbuild',
      rollupOptions: {
        output: {
          assetFileNames: 'style[extname]',
          inlineDynamicImports: true,
        },
      },
      sourcemap: false,
      target: 'es2022',
      write: false,
    },
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'silent',
    plugins: [
      {
        enforce: 'pre',
        load(id) {
          return id === emptyZodLocalesModule ? 'export {}' : null
        },
        name: 'better-convex-empty-zod-locales',
        resolveId(source, importer) {
          return source === '../locales/index.js' &&
            importer !== undefined &&
            /[/\\]zod[/\\]v4[/\\]/u.test(importer)
            ? emptyZodLocalesModule
            : null
        },
      },
      ...(options.vue ? [vue()] : []),
    ],
    resolve: {
      alias: options.aliases,
      dedupe: ['vue'],
    },
  })
  const values = outputs(result as Rollup.RollupOutput | Rollup.RollupOutput[])
  const chunk = values.find(
    (value): value is Rollup.OutputChunk => value.type === 'chunk' && value.isEntry,
  )
  if (!chunk) throw new Error(`Vite emitted no entry chunk for ${entry}`)
  const css = values
    .filter(
      (value): value is Rollup.OutputAsset =>
        value.type === 'asset' && value.fileName.endsWith('.css'),
    )
    .map((value) =>
      typeof value.source === 'string' ? value.source : new TextDecoder().decode(value.source),
    )
    .join('\n')
  return {
    css,
    javaScript: chunk.code,
    modules: Object.keys(chunk.modules).sort(),
  }
}

function inlineHtml(javaScript: string, css: string): string {
  const escapedJavaScript = javaScript.replaceAll('</script', '<\\/script')
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'\">",
    `<style>${css}</style>`,
    '</head>',
    '<body>',
    '<div id="app"></div>',
    `<script>${escapedJavaScript}</script>`,
    '</body>',
    '</html>',
  ].join('')
}

let cachedBuild: Promise<NotesDashboardBuild> | undefined

/** Builds the private app and host from source; no generated bundle is committed. */
export function buildNotesDashboard(
  options: NotesDashboardBuildOptions = {},
): Promise<NotesDashboardBuild> {
  const build = Promise.all([
    bundleEntry(fileURLToPath(new URL('./main.ts', import.meta.url)), {
      aliases: {
        ...(options.extAppsEntry === undefined
          ? {}
          : { '@modelcontextprotocol/ext-apps': options.extAppsEntry }),
        '@lupinum/better-convex-vue/mcp-app':
          options.mcpAppEntry ??
          fileURLToPath(new URL('../../../../../packages/vue/src/mcp-app.ts', import.meta.url)),
      },
      name: 'BetterConvexNotesDashboard',
      vue: true,
    }),
    bundleEntry(fileURLToPath(new URL('./host-harness.ts', import.meta.url)), {
      aliases:
        options.extAppsBridgeEntry === undefined
          ? undefined
          : { '@modelcontextprotocol/ext-apps/app-bridge': options.extAppsBridgeEntry },
      name: 'BetterConvexMcpAppsHostProof',
      vue: false,
    }),
  ]).then(async ([app, host]) => {
    const source = await readFile(new URL('./NotesDashboard.vue', import.meta.url), 'utf8')
    if (source.includes('v-html'))
      throw new Error('The MCP App fixture must not render dynamic HTML')
    return {
      appHtml: inlineHtml(app.javaScript, app.css),
      appModules: app.modules,
      hostJavaScript: host.javaScript,
      hostModules: host.modules,
    }
  })
  if (Object.keys(options).length > 0) return build
  cachedBuild ??= build
  return cachedBuild
}
