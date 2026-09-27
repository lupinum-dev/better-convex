import { fileURLToPath } from 'node:url'

import { defineBuildConfig } from 'unbuild'

const sourceDirectory = fileURLToPath(new URL('./src/', import.meta.url))
const testEntry = fileURLToPath(new URL('./src/test.ts', import.meta.url))

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/test',
    {
      builder: 'copy',
      input: 'agent-docs',
      outDir: 'dist/agent',
    },
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: false,
  },
  externals: ['@modelcontextprotocol/server'],
  hooks: {
    // Keep every shared module in the root entry, so `/test` imports `./index.mjs` and the package
    // keeps one server owner instead of a hashed shared chunk.
    'rollup:options'(_context, options) {
      for (const output of [options.output].flat()) {
        if (output) {
          output.manualChunks = (id) =>
            id.startsWith(sourceDirectory) && id !== testEntry ? 'index' : undefined
        }
      }
    },
  },
})
