import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const unit = process.argv[2]
if (!['vue-nuxt', 'mcp'].includes(unit) || process.argv.length !== 3) {
  throw new Error('Usage: create-release-candidate.mjs vue-nuxt|mcp')
}
if (!/^[0-9a-f]{40}$/u.test(process.env.GITHUB_SHA ?? ''))
  throw new Error('GITHUB_SHA must be an exact source commit.')
if (!/^\d+$/u.test(process.env.GITHUB_RUN_ID ?? ''))
  throw new Error('GITHUB_RUN_ID must identify the source CI run.')

const output = resolve(root, '.release-candidate')
if (existsSync(output)) throw new Error('Release candidate output already exists.')
mkdirSync(output)

const files = []
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.isFile()) files.push(path)
  }
}
walk(resolve(root, '.release-artifacts'))

const expectedNames =
  unit === 'mcp'
    ? ['@lupinum/better-convex-mcp']
    : ['@lupinum/better-convex-vue', '@lupinum/better-convex-nuxt']
const ids = new Map([
  ['@lupinum/better-convex-vue', 'vue'],
  ['@lupinum/better-convex-nuxt', 'nuxt'],
  ['@lupinum/better-convex-mcp', 'mcp'],
])
const evidence = files
  .filter((path) => basename(path) === 'artifact.json')
  .map((path) => ({ path, value: JSON.parse(readFileSync(path, 'utf8')) }))
  .filter(({ value }) => expectedNames.includes(value.packageName))
if (
  evidence.length !== expectedNames.length ||
  new Set(evidence.map((entry) => entry.value.packageName)).size !== expectedNames.length
) {
  throw new Error('The built artifacts do not contain exactly the selected release unit.')
}

const packages = expectedNames.map((name) => {
  const entry = evidence.find((candidate) => candidate.value.packageName === name)
  const value = entry.value
  if (value.sourceCommit !== process.env.GITHUB_SHA)
    throw new Error(`${name} is not bound to the CI source SHA.`)
  const sourceTarball = join(dirname(entry.path), value.tarball?.file ?? '')
  if (basename(sourceTarball) !== value.tarball?.file || !existsSync(sourceTarball))
    throw new Error(`${name} has invalid tarball evidence.`)
  const tarball = basename(sourceTarball)
  const artifact = `${ids.get(name)}-artifact.json`
  cpSync(sourceTarball, join(output, tarball))
  cpSync(entry.path, join(output, artifact))
  const bytes = readFileSync(join(output, tarball))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (sha256 !== value.tarball.sha256 || integrity !== value.tarball.integrity)
    throw new Error(`${name} bytes differ from their evidence.`)
  return { id: ids.get(name), name, version: value.version, tarball, artifact, sha256, integrity }
})
const versions = new Set(packages.map((pkg) => pkg.version))
if (versions.size !== 1) throw new Error('A release unit must have one reviewed version.')
const version = packages[0].version
const tag = unit === 'mcp' ? `mcp-v${version}` : `v${version}`
const metadataSource = files.find(
  (path) => basename(path) === (unit === 'mcp' ? 'mcp-release.json' : 'release.json'),
)
if (!metadataSource) throw new Error('Certified release metadata is missing.')
const metadata = JSON.parse(readFileSync(metadataSource, 'utf8'))
if (
  metadata.sourceSha !== process.env.GITHUB_SHA ||
  metadata.version !== version ||
  metadata.tag !== tag ||
  !metadata.notes?.trim()
) {
  throw new Error('Certified release metadata differs from the selected unit.')
}
cpSync(metadataSource, join(output, 'release-metadata.json'))
const setSource =
  unit === 'vue-nuxt' ? files.find((path) => basename(path) === 'artifact-set.json') : undefined
if (setSource) cpSync(setSource, join(output, 'vue-nuxt-artifact-set.json'))

const assets = readdirSync(output)
  .sort()
  .map((file) => ({
    file,
    sha256: createHash('sha256')
      .update(readFileSync(join(output, file)))
      .digest('hex'),
  }))
const record = {
  schemaVersion: 1,
  sourceSha: process.env.GITHUB_SHA,
  ciRunId: process.env.GITHUB_RUN_ID,
  unit,
  version,
  channel: version.includes('-') ? 'next' : 'latest',
  tag,
  title: `Better Convex ${tag}`,
  notes: metadata.notes.trim(),
  publishOrder: expectedNames,
  packages,
  assets,
}
writeFileSync(join(output, 'release-record.json'), `${JSON.stringify(record, null, 2)}\n`)
writeFileSync(join(output, 'github-release-notes.md'), `${record.notes}\n`)
process.stdout.write(`Created ${relative(root, output)} for ${tag}.\n`)
