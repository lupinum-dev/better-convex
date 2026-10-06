// Used by .github/workflows/release.yml. Never publishes anything itself.
//   node scripts/release.mjs check  prints publish=true when a public package version is not on npm yet
//   node scripts/release.mjs pack   packs those packages into release/ (run `pnpm build` first)
// release/ then holds the tarballs, order.txt (publish order: Vue before Nuxt, which pins it)
// and releases.json. Tags keep the existing scheme: `v<version>` for the fixed Nuxt + Vue
// group, `mcp-v<version>` and `functions-v<version>` for the independently versioned packages.
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const command = process.argv[2]
if (!['check', 'pack'].includes(command))
  throw new Error('Usage: node scripts/release.mjs check|pack')

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

const publishOrder = [
  '@lupinum/better-convex-vue',
  '@lupinum/better-convex-nuxt',
  '@lupinum/better-convex-functions',
  '@lupinum/better-convex-mcp',
]
const ownTag = {
  '@lupinum/better-convex-mcp': 'mcp-v',
  '@lupinum/better-convex-functions': 'functions-v',
}
const tagFor = (pkg) => `${ownTag[pkg.name] ?? 'v'}${pkg.version}`

// Every public package in pnpm-workspace.yaml, including the Nuxt module at the root.
const packages = JSON.parse(run('pnpm', ['-r', 'ls', '--json', '--depth', '-1']))
  .filter((pkg) => !pkg.private)
  .sort((a, b) => publishOrder.indexOf(a.name) - publishOrder.indexOf(b.name))
const unknown = packages.filter((pkg) => !publishOrder.includes(pkg.name))
if (unknown.length) throw new Error(`Add ${unknown.map((pkg) => pkg.name)} to publishOrder.`)
const unpublished = packages.filter((pkg) => !isOnNpm(pkg))

if (command === 'check') {
  const line = `publish=${unpublished.length > 0}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line)
  process.stdout.write(line)
  process.exit(0)
}

const destination = resolve('release')
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination)

const tarballs = []
const byTag = new Map()
for (const pkg of unpublished) {
  const before = new Set(readdirSync(destination))
  run('pnpm', ['pack', '--pack-destination', destination], { cwd: pkg.path })
  tarballs.push(...readdirSync(destination).filter((file) => !before.has(file)))
  // Changesets writes `## <version>` sections; hand-written 1.0.0-rc.0 notes use `## v<version>`.
  const changelogPath = join(pkg.path, 'CHANGELOG.md')
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : ''
  const heading = new RegExp(`^(?:mcp-|functions-)?v?${pkg.version.replaceAll('.', '\\.')}\\s*\\n`)
  const section = changelog.split(/^## /m).find((part) => heading.test(part))
  const body = section ? section.replace(heading, '').trim() : `Release ${pkg.version}.`
  const tag = tagFor(pkg)
  byTag.set(tag, [...(byTag.get(tag) ?? []), { ...pkg, body }])
}

const releases = [...byTag].map(([tag, entries]) => ({
  tag,
  prerelease: entries[0].version.includes('-'),
  notes: entries
    .map((e) => (entries.length > 1 ? `## ${e.name}\n\n${e.body}` : e.body))
    .join('\n\n'),
}))
writeFileSync(join(destination, 'order.txt'), `${tarballs.join('\n')}\n`)
writeFileSync(join(destination, 'releases.json'), `${JSON.stringify(releases, null, 2)}\n`)
console.log(releases.map((r) => r.tag).join('\n'))
