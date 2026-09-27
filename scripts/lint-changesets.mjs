// Checks the changeset style described in AGENTS.md. When origin/main exists
// (CI on pull requests), it also requires a changeset if published source changed.
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
  const migration = rest.findIndex((line) => line.startsWith('Migration:'))
  if (rest.length && migration !== 0)
    failures.push(`${file}: keep the summary to one line. Only a "Migration:" note may follow.`)
  if (/:\s*["']?major["']?\s*$/m.test(frontMatter) && migration === -1) {
    failures.push(`${file}: a major change needs a "Migration:" line that tells users what to do.`)
  }
}

const hasBase = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main']).status === 0
if (hasBase) {
  const diff = spawnSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { encoding: 'utf8' })
  const sourceChanged = diff.stdout
    .split('\n')
    .some((path) => /^(?:src|packages\/[^/]+\/src)\//.test(path))
  if (
    sourceChanged &&
    spawnSync('pnpm', ['exec', 'changeset', 'status', '--since=origin/main'], { stdio: 'inherit' })
      .status !== 0
  ) {
    failures.push(
      'Published source changed without a changeset. Run `pnpm changeset`, or `pnpm changeset --empty` if users see no change.',
    )
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log('Changesets look good.')
