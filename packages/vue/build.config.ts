import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index', 'src/errors', 'src/embedded'],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: false,
  },
  externals: ['convex', 'vue'],
})
