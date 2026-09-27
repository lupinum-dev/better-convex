import { resolve } from 'node:path'

import { inspectConsumerCandidate } from './package-consumer-candidate.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')

/** Reads `--tarball <path>` (check-starters packs it) and checks it is the packed Vue package. */
export function prepareVueCandidate(args) {
  if (args.length !== 2 || args[0] !== '--tarball' || !args[1]) {
    throw new Error('Usage: <vue-consumer-check> --tarball <path>')
  }
  const tarballPath = resolve(repositoryRoot, args[1])
  const inspected = inspectConsumerCandidate({
    packageName: '@lupinum/better-convex-vue',
    tarballPath,
  })

  return {
    tarballPath,
    version: inspected.manifest.version,
    assertInstalled: inspected.assertInstalled,
  }
}
