import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseDocument } from 'yaml'

import { checkDependencyPolicy } from './check-dependency-policy.mjs'

// Preserve the consumer's companion overrides and strict peers. Workspace-only
// resolutions must not replace the published graph or selected framework floor.
export function prepareConsumerDependencyPolicy(directory, now = Date.now()) {
  const maintainedSource = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const maintainedFailures = checkDependencyPolicy(maintainedSource, now)
  if (maintainedFailures.length) throw new Error(maintainedFailures.join('\n'))
  const maintained = parseDocument(maintainedSource)
  const path = join(directory, 'pnpm-workspace.yaml')
  const source = existsSync(path) ? readFileSync(path, 'utf8') : 'packages: []\n'
  const document = parseDocument(source)
  if (document.errors.length)
    throw new Error(document.errors.map((error) => error.message).join('\n'))
  let changed = !existsSync(path)
  for (const key of [
    'minimumReleaseAge',
    'minimumReleaseAgeStrict',
    'minimumReleaseAgeIgnoreMissingTime',
    'minimumReleaseAgeExclude',
  ]) {
    if (!document.has(key) && maintained.has(key)) {
      document.set(key, maintained.get(key, true).clone())
      changed = true
    }
  }
  if (changed) writeFileSync(path, document.toString())
  const failures = checkDependencyPolicy(readFileSync(path, 'utf8'), now)
  if (failures.length) throw new Error(failures.join('\n'))
  // npm's age cutoff does not broaden exact exceptions to package-name exemptions.
  return `--before=${new Date(now - document.get('minimumReleaseAge') * 60_000).toISOString()}`
}
