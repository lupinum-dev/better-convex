// Checks the changeset style described in AGENTS.md. When origin/main exists (CI on pull
// requests), it also requires a changeset if published source changed, and a changeset that
// bumps a published package whose dependencies or peerDependencies changed.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' })
const bumps = text => [...text.matchAll(/^\s*['"]?([^\s'":]+)['"]?\s*:\s*['"]?(major|minor|patch)['"]?\s*$/gm)].map(([, name, bump]) => ({ name, bump }))

const failures = []
for (const file of readdirSync('.changeset').filter(name => name.endsWith('.md') && name !== 'README.md')) {
  const match = /^---\r?\n([\s\S]*?)^---\r?\n?([\s\S]*)$/m.exec(readFileSync(`.changeset/${file}`, 'utf8'))
  if (!match) {
    failures.push(`${file}: missing the --- front matter block.`)
    continue
  }
  const [, frontMatter, body] = match
  if (!frontMatter.trim() && !body.trim()) continue // `pnpm changeset --empty`
  // The first paragraph is the one-line summary; an optional short body follows after a blank line.
  const [summary = '', ...details] = body.trim().split(/\r?\n\s*\n/)
  if (!/^(?:Fix|Add|Remove|Change) \S/.test(summary.trim())) {
    failures.push(`${file}: start with one user-facing line that begins with Fix, Add, Remove or Change.`)
  }
  if (summary.trim().includes('\n')) failures.push(`${file}: keep the summary to one line. Put details after a blank line.`)
  if (bumps(frontMatter).some(({ bump }) => bump === 'major') && !details.some(part => /^Migration:/m.test(part))) {
    failures.push(`${file}: a major change needs a "Migration:" line that tells users what to do.`)
  }
}

const base = git('merge-base', 'origin/main', 'HEAD').stdout.trim()
if (base) {
  const changed = git('diff', '--name-only', `${base}...HEAD`).stdout.split('\n').filter(Boolean)
  if (changed.some(path => /^(?:src|packages\/[^/]+\/src)\//.test(path)) && spawnSync('pnpm', ['exec', 'changeset', 'status', `--since=${base}`], { stdio: 'inherit' }).status !== 0) {
    failures.push('Published source changed without a changeset. Run `pnpm changeset`, or `pnpm changeset --empty` if users see no change.')
  }

  // Users install new dependencies with the next version, so an empty changeset is not enough.
  const manifests = ['package.json', ...(existsSync('packages') ? readdirSync('packages').map(dir => `packages/${dir}/package.json`) : [])]
    .filter(path => existsSync(path)).map(path => ({ path, now: JSON.parse(readFileSync(path, 'utf8')) }))
  const internal = new Set(manifests.map(({ now }) => now.name)) // Changesets itself bumps these ranges
  const external = deps => JSON.stringify(Object.entries(deps ?? {}).filter(([name]) => !internal.has(name)).sort())
  // Added or edited changesets count; archived ones under .changeset/pre/ do not release.
  const added = git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', '.changeset').stdout.split('\n').filter(path => /^\.changeset\/[^/]+\.md$/.test(path))
  const bumped = new Set(added.filter(path => existsSync(path)).flatMap(path => bumps(/^---\r?\n([\s\S]*?)^---/m.exec(readFileSync(path, 'utf8'))?.[1] ?? '')).map(({ name }) => name))
  for (const { path, now } of manifests) {
    if (now.private || !changed.includes(path)) continue
    const before = git('show', `${base}:${path}`)
    if (before.status !== 0) continue // a new package is released with its starting version
    const then = JSON.parse(before.stdout)
    const depsChanged = ['dependencies', 'peerDependencies'].some(field => external(then[field]) !== external(now[field]))
    if (depsChanged && !bumped.has(now.name)) {
      failures.push(`${path}: dependencies or peerDependencies changed. Add a changeset that bumps ${now.name} (at least patch).`)
    }
  }
}

if (failures.length) {
  console.error(failures.map(failure => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log('Changesets look good.')
