// Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds.
// In vercel.json: "ignoreCommand": "node scripts/vercel-ignore.mjs <paths that feed the site>"
// Paths are git pathspecs relative to the Root Directory, for example `. ../pnpm-lock.yaml`.
//
// We build only when those paths changed since the commit Vercel last built for this branch
// (VERCEL_GIT_PREVIOUS_SHA). A branch without an earlier build is compared with main, so its
// first push is judged too. Vercel clones shallowly, so the commit to compare with is often
// missing from the clone; we fetch it instead of building blindly. If git still cannot
// answer, we build to stay safe.
import { spawnSync } from 'node:child_process'

const paths = process.argv.slice(2)
const git = (...args) => spawnSync('git', args, { stdio: 'ignore' }).status ?? 1
const {
  VERCEL_GIT_COMMIT_REF: branch,
  VERCEL_GIT_COMMIT_SHA: sha,
  VERCEL_GIT_PREVIOUS_SHA: previousSha,
} = process.env

function hasCommit(ref) {
  return git('cat-file', '-e', `${ref}^{commit}`) === 0
}

if (!paths.length || !branch) process.exit(1)
// Same commit as the last deployment: a deliberate redeploy (new env values), so build.
if (previousSha && previousSha === sha) process.exit(1)

let range
if (previousSha) {
  if (!hasCommit(previousSha)) git('fetch', '--no-tags', '--depth=1', 'origin', previousSha)
  // The last build may hold a change that this push took back, so main cannot stand in for it.
  if (!hasCommit(previousSha)) process.exit(1)
  range = [previousSha, 'HEAD']
}
if (!range) {
  // main has nothing else to compare with.
  if (branch === 'main') process.exit(1)
  git('fetch', '--no-tags', '--depth=200', 'origin', '+refs/heads/main:refs/remotes/origin/main')
  // Three-dot diff (only the branch's own changes) needs the fork point in the clone.
  git('fetch', '--no-tags', '--deepen=200', 'origin', branch)
  // Without the fork point, comparing the two tips could hide a change, so build.
  if (git('merge-base', 'origin/main', 'HEAD') !== 0) process.exit(1)
  range = ['origin/main...HEAD']
}

// git diff --quiet: 0 = no changes (skip), 1 = changes (build), other = error (build).
process.exit(git('diff', '--quiet', ...range, '--', ...paths) === 0 ? 0 : 1)
