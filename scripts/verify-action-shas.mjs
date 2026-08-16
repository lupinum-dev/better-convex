import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { parse } from 'yaml'

async function workflowFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await workflowFiles(path)))
    else if (/\.ya?ml$/u.test(entry.name)) files.push(path)
  }
  return files
}
function actionReferences(workflow, path) {
  const references = new Set()
  const add = (raw) => {
    const value = String(raw ?? '')
    if (!value || value.startsWith('./')) return
    const match = value.match(/^([^/]+\/[^/@]+)(?:\/[^@]+)?@([0-9a-f]{40})$/u)
    if (!match) {
      throw new Error(`${path}: external action must use a full commit SHA: ${value}`)
    }
    references.add(`${match[1]}@${match[2]}`)
  }

  for (const job of Object.values(workflow?.jobs ?? {})) {
    add(job?.uses)
    for (const step of job?.steps ?? []) add(step?.uses)
  }
  return references
}

const probeSha = '0'.repeat(40)
const probe = actionReferences(
  parse(
    `jobs: { reusable: { uses: owner/workflows/.github/workflows/ci.yml@${probeSha} }, steps: { runs-on: ubuntu-latest, steps: [ { uses: owner/action@${probeSha} } ] } }`,
  ),
  '<parser probe>',
)
if (probe.size !== 2) {
  throw new Error('Action verification must inspect flow-style steps and reusable workflows.')
}

const references = new Set()
for (const path of await workflowFiles('.github/workflows')) {
  const workflow = parse(await readFile(path, 'utf8'))
  for (const reference of actionReferences(workflow, path)) references.add(reference)
}
if (references.size === 0) throw new Error('No pinned action references were found.')

for (const reference of [...references].sort()) {
  const [repository, sha] = reference.split('@')
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`${reference} is not a valid upstream commit: HTTP ${response.status}.`)
  }
  const commit = await response.json()
  if (commit.sha !== sha) throw new Error(`${reference} resolved to ${commit.sha}.`)
  console.log(`Verified ${reference}.`)
}
