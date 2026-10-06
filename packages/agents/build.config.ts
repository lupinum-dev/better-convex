import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/mcp',
    'src/internal',
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
  externals: [
    '@lupinum/better-convex-functions',
    '@lupinum/better-convex-functions/internal',
    '@modelcontextprotocol/server',
    'convex',
    'convex/server',
    'convex/values',
  ],
})
