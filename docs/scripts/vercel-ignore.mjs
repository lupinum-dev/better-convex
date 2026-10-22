// Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds.
// The docs site only reads files under docs/, so we build only when docs/ changed.
// Vercel clones shallowly, so the commit we compare against is often missing from the
// clone (new branches, force-pushed release branches). We fetch it instead of building
// blindly; if git still cannot answer, we build to stay safe.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const git = (...args) => spawnSync('git', args, { cwd: root, stdio: 'ignore' }).status ?? 1
const hasCommit = (ref) => git('cat-file', '-e', `${ref}^{commit}`) === 0

const branch = process.env.VERCEL_GIT_COMMIT_REF
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA

// Production: compare with the last deployed commit on main.
// Preview: compare with main, so the first push of a branch is judged too.
let range
if (branch === 'main') {
  if (!previousSha) process.exit(1)
  if (!hasCommit(previousSha)) git('fetch', '--no-tags', '--depth=1', 'origin', previousSha)
  if (!hasCommit(previousSha)) process.exit(1)
  range = [previousSha, 'HEAD']
} else {
  git('fetch', '--no-tags', '--depth=200', 'origin', '+refs/heads/main:refs/remotes/origin/main')
  // Three-dot diff (only the branch's own changes) needs the fork point in the clone.
  git('fetch', '--no-tags', '--deepen=200', 'origin', branch)
  // Without the fork point, comparing the two tips could hide a docs change, so build.
  if (git('merge-base', 'origin/main', 'HEAD') !== 0) process.exit(1)
  range = ['origin/main...HEAD']
}

const status = git('diff', '--quiet', ...range, '--', 'docs')
// git diff --quiet: 0 = no changes (skip), 1 = changes (build), other = error (build).
process.exit(status === 0 ? 0 : 1)
