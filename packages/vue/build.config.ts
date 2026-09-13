import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/errors',
    'src/embedded',
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
