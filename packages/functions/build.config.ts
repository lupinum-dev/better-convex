import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/internal',
    // Client-safe: imports nothing, checked on the packed build (test/packed/check-packed.mjs).
    { input: 'src/policy-entry', name: 'policy' },
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
  externals: ['convex', 'convex/server', 'convex/values'],
})
