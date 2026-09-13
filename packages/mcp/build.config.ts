import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/vue',
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
  externals: ['@modelcontextprotocol/ext-apps', '@modelcontextprotocol/server', 'vue'],
})
