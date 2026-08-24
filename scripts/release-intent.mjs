import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspect } from './reconcile-release.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

export function releaseUnits({ workspaceVersion, vueVersion, mcpVersion }) {
  if (workspaceVersion !== vueVersion) {
    throw new Error(`Vue/Nuxt versions must remain coupled (${vueVersion} != ${workspaceVersion}).`)
  }
  return [
    {
      id: 'vue-nuxt',
      version: workspaceVersion,
      tag: `v${workspaceVersion}`,
      packages: ['@lupinum/better-convex-vue', '@lupinum/better-convex-nuxt'],
    },
    {
      id: 'mcp',
      version: mcpVersion,
      tag: `mcp-v${mcpVersion}`,
      packages: ['@lupinum/better-convex-mcp'],
    },
  ].map((unit) => ({ ...unit, channel: unit.version.includes('-') ? 'next' : 'latest' }))
}

export function detectReleaseIntents(changelog, versions) {
  return releaseUnits(versions).filter((unit) =>
    new RegExp(`^##\\s+${escapeRegExp(unit.tag)}(?:\\s|$)`, 'mu').test(changelog),
  )
}

function npmIntegrity(spec) {
  const result = spawnSync('npm', ['view', spec, 'dist.integrity', '--json'], {
    encoding: 'utf8',
  })
  if (result.status === 0) return JSON.parse(result.stdout.trim() || 'null')
  if (/E404|404 Not Found/u.test(result.stderr)) return null
  throw new Error(`npm view failed for ${spec}: ${result.stderr.trim()}`)
}

export function classifyCandidateNeed(publications) {
  const present = publications.filter(Boolean).length
  if (present === 0) return 'build'
  if (present === publications.length) return 'reuse'
  return 'partial'
}

export function classifyReleaseIntent({ publications, tag, release }) {
  const packages = classifyCandidateNeed(publications)
  if (![tag, release].every((state) => ['absent', 'present'].includes(state))) {
    throw new Error('GitHub release state is unverified.')
  }
  if (packages !== 'reuse' && (tag === 'present' || release === 'present')) {
    throw new Error('Public GitHub history exists before npm publication is complete.')
  }
  if (packages === 'reuse' && tag === 'present' && release === 'present') return 'verify'
  return packages === 'build' ? 'build' : 'repair'
}

export function selectIncompleteIntent(states) {
  const incomplete = states.filter(({ state }) => state !== 'complete')
  if (incomplete.length > 1) {
    throw new Error(
      `Multiple incomplete release intents are active (${incomplete.map(({ intent }) => intent.tag).join(', ')}). Finish the earlier release before merging another intent.`,
    )
  }
  return incomplete[0]
}

function readVersions() {
  const manifest = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8')).version
  return {
    workspaceVersion: manifest('package.json'),
    vueVersion: manifest('packages/vue/package.json'),
    mcpVersion: manifest('packages/mcp/package.json'),
  }
}

function githubPresence(path) {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository) throw new Error('GitHub release inspection requires GITHUB_REPOSITORY.')
  const result = spawnSync('gh', ['api', `repos/${repository}/${path}`], { encoding: 'utf8' })
  if (result.status === 0) return 'present'
  if (/HTTP 404|Not Found/u.test(result.stderr)) return 'absent'
  throw new Error(`GitHub release state is unavailable for ${path}: ${result.stderr.trim()}`)
}

async function verifyCompletedRelease(intent) {
  const directory = mkdtempSync(join(tmpdir(), 'better-convex-intent-'))
  try {
    const download = spawnSync(
      'gh',
      [
        'release',
        'download',
        intent.tag,
        '--repo',
        process.env.GITHUB_REPOSITORY,
        '--dir',
        directory,
      ],
      { encoding: 'utf8' },
    )
    if (download.status !== 0) {
      throw new Error(`Could not download ${intent.tag} evidence: ${download.stderr.trim()}`)
    }
    const record = JSON.parse(readFileSync(join(directory, 'release-record.json'), 'utf8'))
    if (
      record.unit !== intent.id ||
      record.version !== intent.version ||
      record.tag !== intent.tag ||
      JSON.stringify(record.packages.map(({ name }) => name)) !== JSON.stringify(intent.packages)
    ) {
      throw new Error(`${intent.tag} Release evidence does not match its manifest-derived unit.`)
    }
    return (await inspect(directory, record)).action
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--github-output')
  const output = outputIndex === -1 ? undefined : process.argv[outputIndex + 1]
  const summaryIndex = process.argv.indexOf('--summary')
  const summary = summaryIndex === -1 ? undefined : process.argv[summaryIndex + 1]
  const intents = detectReleaseIntents(
    readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'),
    readVersions(),
  )
  const states = []
  for (const intent of intents) {
    const publications = intent.packages.map((name) => npmIntegrity(`${name}@${intent.version}`))
    const initialState = classifyReleaseIntent({
      publications,
      tag: githubPresence(`git/ref/tags/${encodeURIComponent(intent.tag)}`),
      release: githubPresence(`releases/tags/${encodeURIComponent(intent.tag)}`),
    })
    states.push({
      intent,
      publications,
      state: initialState === 'verify' ? await verifyCompletedRelease(intent) : initialState,
    })
  }
  const selected = selectIncompleteIntent(states)
  if (!selected) {
    if (output) appendFileSync(output, 'ready=false\naction=no-op\n')
    if (summary)
      appendFileSync(summary, '\n## Release candidate\n\nNo incomplete release intent exists.\n')
    process.exit(0)
  }
  const { intent, state } = selected
  const ready = state === 'build'
  if (output) {
    for (const [name, value] of Object.entries({
      ready: String(ready),
      action: ready ? 'build' : 'repair',
      unit: intent.id,
      version: intent.version,
      channel: intent.channel,
      tag: intent.tag,
      packages: intent.packages.join(','),
    }))
      appendFileSync(output, `${name}=${value}\n`)
  }
  if (summary)
    appendFileSync(
      summary,
      `\n## Release candidate\n\n- Intent: \`${intent.tag}\`\n- Unit: \`${intent.id}\`\n- Release state: \`${state}\`\n- Next action: ${ready ? 'Build and retain the exact candidate once.' : 'Reuse the original retained candidate for reconciliation; never build replacement bytes.'}\n`,
    )
}
