import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/errors',
    'src/embedded',
    // Private Nuxt integration seam; see src/internal.ts. Not public API.
    'src/internal',
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
  externals: ['convex', 'vue'],
})
