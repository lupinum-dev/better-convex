import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index', 'src/errors', 'src/embedded', 'src/mcp-app'],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: false,
  },
  externals: ['@modelcontextprotocol/ext-apps', 'convex', 'vue'],
})
