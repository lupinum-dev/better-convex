// Where `pnpm test:live` runs. The smoke deploys the starter and its operator-only test
// functions (test/fixtures/mcp-oauth-agent/evidence.ts), which can disable users and delete OAuth
// clients. So it deploys only to a throwaway preview deployment, never to production.
import { randomBytes } from 'node:crypto'

export type LiveTarget =
  | { kind: 'local' }
  | { kind: 'preview'; deployKey: string; previewName: string }

const previewName = /^[a-z0-9][a-z0-9-]{0,62}$/u

/** Reads the target from the environment; throws for a key that is not a preview deploy key. */
export function liveTarget(env: NodeJS.ProcessEnv): LiveTarget {
  const deployKey = env.CONVEX_DEPLOY_KEY
  if (!deployKey) {
    if (env.BCN_LIVE_LOCAL === '1') return { kind: 'local' }
    throw new Error(
      'pnpm test:live needs CONVEX_DEPLOY_KEY (a preview deploy key), or BCN_LIVE_LOCAL=1 for a dry run on the local backend. See test/TESTING.md.',
    )
  }
  // Deploy keys start with their kind: `prod:`, `dev:`, `preview:` or `project:`.
  if (!deployKey.startsWith('preview:')) {
    // Name only the kind: the rest of the key is a secret.
    const kind = /^([a-z]+):/u.exec(deployKey)?.[1] ?? 'unknown'
    throw new Error(
      `CONVEX_DEPLOY_KEY is a "${kind}" key. pnpm test:live deploys only to a fresh preview deployment, so it needs a preview deploy key.`,
    )
  }
  const name = env.BCN_LIVE_PREVIEW_NAME ?? `bcn-live-local-${randomBytes(4).toString('hex')}`
  if (!previewName.test(name)) {
    throw new Error(`BCN_LIVE_PREVIEW_NAME "${name}" must be lowercase letters, digits and dashes.`)
  }
  return { kind: 'preview', deployKey, previewName: name }
}
