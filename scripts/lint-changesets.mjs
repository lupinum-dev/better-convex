// Checks the changeset style described in AGENTS.md. When origin/main exists
// (CI on pull requests), it also requires a changeset if published source changed,
// and a changeset that bumps a published package whose dependencies or peer
// dependencies changed.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

const failures = []
for (const file of readdirSync('.changeset').filter(
  (name) => name.endsWith('.md') && name !== 'README.md',
)) {
  const match = /^---\r?\n([\s\S]*?)^---\r?\n?([\s\S]*)$/m.exec(
    readFileSync(`.changeset/${file}`, 'utf8'),
  )
  if (!match) {
    failures.push(`${file}: missing the --- front matter block.`)
    continue
  }
  const [, frontMatter, body] = match
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!frontMatter.trim() && !lines.length) continue // `pnpm changeset --empty`
  const [summary = '', ...rest] = lines
  if (!/^(?:Fix|Add|Remove|Change) \S/.test(summary)) {
    failures.push(
      `${file}: start with one user-facing line that begins with Fix, Add, Remove or Change.`,
    )
  }
  if (rest.length > 5)
    failures.push(`${file}: keep it short: one summary line, then at most five lines of detail.`)
  if (
    /:\s*["']?major["']?\s*$/m.test(frontMatter) &&
    !rest.some((line) => line.startsWith('Migration:'))
  ) {
    failures.push(`${file}: a major change needs a "Migration:" line that tells users what to do.`)
  }
}

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' })
const bumps = (frontMatter) =>
  [
    ...frontMatter.matchAll(
      /^\s*['"]?([^\s'":]+)['"]?\s*:\s*['"]?(?:major|minor|patch)['"]?\s*$/gm,
    ),
  ].map(([, name]) => name)

const hasBase = git('rev-parse', '--verify', '--quiet', 'origin/main').status === 0
if (hasBase) {
  const base = git('merge-base', 'origin/main', 'HEAD').stdout.trim()
  const changed = git('diff', '--name-only', `${base}..HEAD`).stdout.split('\n')
  if (
    changed.some((path) => /^(?:src|packages\/[^/]+\/src)\//.test(path)) &&
    spawnSync('pnpm', ['exec', 'changeset', 'status', '--since=origin/main'], { stdio: 'inherit' })
      .status !== 0
  ) {
    failures.push(
      'Published source changed without a changeset. Run `pnpm changeset`, or `pnpm changeset --empty` if users see no change.',
    )
  }

  // Users install new dependencies with the next version, so an empty changeset is not enough.
  // Ranges on this repository's own packages are bumped by Changesets itself and are ignored.
  const manifests = [
    'package.json',
    'packages/agents/package.json',
    'packages/functions/package.json',
    'packages/vue/package.json',
  ]
  const internal = new Set(manifests.map((path) => JSON.parse(readFileSync(path, 'utf8')).name))
  const installed = (pkg) =>
    JSON.stringify(
      ['dependencies', 'peerDependencies'].map((field) =>
        Object.entries(pkg[field] ?? {})
          .filter(([name]) => !internal.has(name))
          .sort(),
      ),
    )
  const bumped = new Set(
    // Added or edited changesets count; archived ones under .changeset/pre/ do not release.
    git('diff', '--name-only', '--diff-filter=AM', `${base}..HEAD`, '--', '.changeset')
      .stdout.split('\n')
      .filter((path) => /^\.changeset\/[^/]+\.md$/.test(path))
      .flatMap((path) => {
        const file = git('show', `HEAD:${path}`).stdout
        return bumps(/^---\r?\n([\s\S]*?)^---/m.exec(file)?.[1] ?? '')
      }),
  )
  for (const path of manifests.filter((path) => changed.includes(path))) {
    const now = JSON.parse(readFileSync(path, 'utf8'))
    const before = git('show', `${base}:${path}`)
    if (now.private || before.status !== 0) continue
    if (installed(JSON.parse(before.stdout)) !== installed(now) && !bumped.has(now.name)) {
      failures.push(
        `${path}: dependencies or peerDependencies changed. Add a changeset that bumps ${now.name} (at least patch).`,
      )
    }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log('Changesets look good.')
