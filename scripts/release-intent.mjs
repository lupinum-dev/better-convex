import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function readVersions() {
  const manifest = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8')).version
  return {
    workspaceVersion: manifest('package.json'),
    vueVersion: manifest('packages/vue/package.json'),
    mcpVersion: manifest('packages/mcp/package.json'),
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
  if (intents.length > 1) {
    throw new Error(
      `Multiple release intents are active (${intents.map((intent) => intent.tag).join(', ')}). Finish the earlier release before merging another intent.`,
    )
  }
  const intent = intents[0]
  if (!intent) {
    if (output) appendFileSync(output, 'ready=false\naction=no-op\n')
    if (summary)
      appendFileSync(summary, '\n## Release candidate\n\nNo incomplete release intent exists.\n')
    process.exit(0)
  }
  const state = classifyCandidateNeed(
    intent.packages.map((name) => npmIntegrity(`${name}@${intent.version}`)),
  )
  if (state === 'partial') {
    throw new Error(
      `${intent.tag} is partially published. Reuse its retained candidate; never build replacement bytes.`,
    )
  }
  const ready = state === 'build'
  if (output) {
    for (const [name, value] of Object.entries({
      ready: String(ready),
      action: ready ? 'build' : 'reuse',
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
      `\n## Release candidate\n\n- Intent: \`${intent.tag}\`\n- Unit: \`${intent.id}\`\n- Registry state: \`${state}\`\n- Next action: ${ready ? 'Build and retain the exact candidate once.' : 'Reuse the original retained candidate for reconciliation.'}\n`,
    )
}
