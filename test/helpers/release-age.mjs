// The dependency quarantine for the scratch pnpm workspaces that the packed and
// integration checks write. It repeats the root `minimumReleaseAgeExclude` list,
// so an urgent exact-version exception (see the Lupinum OSS handbook) is made
// once, in the root `pnpm-workspace.yaml`, and every scratch install honours it.
import { readFileSync } from 'node:fs'

const root = readFileSync(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8')
const exclude = /^minimumReleaseAgeExclude:\n(?:[ \t]+-.*\n)+/m.exec(root)?.[0] ?? ''

/** `minimumReleaseAge` plus the root exclusions, as pnpm-workspace.yaml lines. */
export const RELEASE_AGE_YAML = `minimumReleaseAge: 1440\n${exclude}`
