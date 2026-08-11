import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const packageRoot = join(repositoryRoot, 'packages/vue')

function parseTarballArgument(args) {
  if (args.length === 0) return undefined
  if (args.length !== 2 || args[0] !== '--tarball' || !args[1]) {
    throw new Error('Usage: <vue-consumer-check> [--tarball <path>]')
  }
  return resolve(repositoryRoot, args[1])
}

export function prepareVueCandidate(args, scratchRoot) {
  let tarballPath = parseTarballArgument(args)
  if (!tarballPath) {
    execFileSync('pnpm', ['run', 'build'], {
      cwd: packageRoot,
      stdio: 'inherit',
    })
    const result = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', scratchRoot],
        { cwd: packageRoot, encoding: 'utf8' },
      ),
    )
    if (!Array.isArray(result) || result.length !== 1 || !result[0]?.filename) {
      throw new Error('Vue package pack must produce exactly one tarball')
    }
    tarballPath = join(scratchRoot, result[0].filename)
  }

  const inspected = inspectConsumerCandidate({
    packageId: 'vue',
    packageName: 'better-convex-vue',
    tarballPath,
  })

  return {
    tarballPath,
    version: inspected.manifest.version,
    assertInstalled: inspected.assertInstalled,
    cleanup: inspected.cleanup,
  }
}
