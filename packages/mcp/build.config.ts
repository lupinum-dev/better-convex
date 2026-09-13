import { execFileSync } from 'node:child_process'

import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: ['src/index', 'src/vue'],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: false,
  },
  externals: ['@modelcontextprotocol/ext-apps', '@modelcontextprotocol/server', 'vue'],
  hooks: {
    'rollup:done'() {
      execFileSync('node', ['scripts/build-agent-docs.mjs'], {
        cwd: new URL('../..', import.meta.url),
        stdio: 'inherit',
      })
    },
  },
})
