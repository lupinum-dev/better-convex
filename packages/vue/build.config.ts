import { execFileSync } from 'node:child_process'

import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index', 'src/errors', 'src/embedded'],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: false,
  },
  externals: ['convex', 'vue'],
  hooks: {
    'rollup:done'() {
      execFileSync('node', ['scripts/build-agent-docs.mjs'], {
        cwd: new URL('../..', import.meta.url),
        stdio: 'inherit',
      })
    },
  },
})
