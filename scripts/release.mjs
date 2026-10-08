// Used by .github/workflows/release.yml. Never publishes anything itself.
//   node scripts/release.mjs check  prints publish=true when a public workspace package version is not on npm yet
//   node scripts/release.mjs pack   packs those packages into release/ with releases.json (run `pnpm build` first)
//   node scripts/release.mjs version-needed  prints true when `changeset version` has work: a pending changeset or a prerelease exit
// Tags: `v<version>` when there is one public package or all of them are in one Changesets `fixed`
// group; otherwise one `<name>@<version>` tag and GitHub release per package.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const command = process.argv[2]
if (!['check', 'pack', 'version-needed'].includes(command)) throw new Error('Usage: node scripts/release.mjs check|pack|version-needed')

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed:\n${result.stderr}`)
  return result.stdout
}

function isOnNpm({ name, version }) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' })
  if (result.status === 0) return result.stdout.trim() === version
  if (/E404/.test(result.stderr)) return false // the package does not exist yet
  throw new Error(`npm view ${name} failed:\n${result.stderr}`)
}

if (command === 'version-needed') {
  const pending = readdirSync('.changeset', { withFileTypes: true }).some(file => file.isFile() && file.name.endsWith('.md') && file.name !== 'README.md')
  const pre = existsSync('.changeset/pre.json') ? JSON.parse(readFileSync('.changeset/pre.json', 'utf8')) : null
  console.log(pending || pre?.mode === 'exit')
  process.exit(0)
}

// Every package in pnpm-workspace.yaml (and the root), wherever it lives.
const packages = JSON.parse(run('pnpm', ['-r', 'ls', '--json', '--depth', '-1'])).filter(pkg => !pkg.private)
const names = packages.map(pkg => pkg.name)
const { fixed = [] } = JSON.parse(readFileSync('.changeset/config.json', 'utf8'))
// Changesets allows globs in `fixed`, such as "@scope/*".
const matches = (pattern, name) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`).test(name)
const shared = names.length === 1 || fixed.some(group => names.every(name => group.some(pattern => matches(pattern, name))))
const tag = (pkg, version) => shared ? `v${version}` : `${pkg.name}@${version}`

const unpublished = packages.filter(pkg => !isOnNpm(pkg))
if (command === 'check') {
  const line = `publish=${unpublished.length > 0}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line)
  process.stdout.write(line)
  process.exit(0)
}

const destination = resolve('release')
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination)

// Dependencies first: a package that pins a sibling's exact version is not installable
// until that sibling is on npm. The number prefix makes `release/*.tgz` publish in this order.
const dependsOn = (pkg) => {
  const manifest = JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'))
  return Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })
}
const ordered = []
const visit = (pkg, path = []) => {
  if (ordered.includes(pkg)) return
  // No publish order is safe in a cycle: whichever goes first pins a version that is not on npm yet.
  if (path.includes(pkg)) throw new Error(`Dependency cycle: ${[...path, pkg].map(p => p.name).join(' -> ')}`)
  for (const name of dependsOn(pkg)) {
    const sibling = unpublished.find(other => other.name === name)
    if (sibling) visit(sibling, [...path, pkg])
  }
  ordered.push(pkg)
}
unpublished.forEach(pkg => visit(pkg))

const notes = ordered.map((pkg, index) => {
  const scratch = join(destination, `pack-${index}`)
  run('pnpm', ['pack', '--pack-destination', scratch], { cwd: pkg.path })
  for (const file of readdirSync(scratch)) renameSync(join(scratch, file), join(destination, `${String(index + 1).padStart(Math.max(2, String(ordered.length).length), '0')}-${file}`))
  rmSync(scratch, { recursive: true })
  // Changesets writes `## <version>` sections into each package's CHANGELOG.md.
  const changelogPath = join(pkg.path, 'CHANGELOG.md')
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''
  const section = changelog.split(/^## /m).find(part => part.startsWith(`${pkg.version}\n`))
  return { ...pkg, body: section ? section.slice(pkg.version.length).trim() : `Release ${pkg.version}.` }
})

const entry = (tag, version, text) => ({ tag, notes: text, prerelease: version.includes('-') })
const { version } = packages[0]
const releases = shared
  ? [entry(tag(packages[0], version), version, notes.map(n => (notes.length > 1 ? `## ${n.name}\n\n${n.body}` : n.body)).join('\n\n'))]
  : notes.map(n => entry(tag(n, n.version), n.version, n.body))
writeFileSync(join(destination, 'releases.json'), `${JSON.stringify(releases, null, 2)}\n`)
console.log(releases.map(r => r.tag).join('\n'))
