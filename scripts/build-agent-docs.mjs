import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildPackageAgentDocs, verifyPackageAgentDocs } from './package-agent-docs.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(repositoryRoot, 'docs/.output/public/raw')

if (!existsSync(sourceRoot)) {
  execFileSync('pnpm', ['--dir', 'docs', 'build'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
}

const packages = [
  {
    packageRoot: repositoryRoot,
    startRoutes: [
      '/docs/get-started/choose-your-path',
      '/docs/get-started/installation',
      '/docs/overview/limitations',
    ],
  },
  {
    packageRoot: resolve(repositoryRoot, 'packages/vue'),
    startRoutes: [
      '/docs/get-started/choose-your-path',
      '/docs/get-started/plain-vue',
      '/docs/overview/limitations',
    ],
  },
  {
    packageRoot: resolve(repositoryRoot, 'packages/mcp'),
    startRoutes: [
      '/docs/build/agents/mcp',
      '/docs/build/authentication/delegated-oauth-and-mcp',
      '/docs/overview/limitations',
    ],
  },
]

for (const entry of packages) {
  const manifest = await buildPackageAgentDocs({ ...entry, sourceRoot })
  await verifyPackageAgentDocs(entry.packageRoot, { sourceRoot })
  console.log(
    `Installed documentation: ${manifest.name}@${manifest.version}, ${manifest.pages.length} verified pages.`,
  )
}
