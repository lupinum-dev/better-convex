import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const token = process.env.GITHUB_TOKEN
if (!token) throw new Error('GITHUB_TOKEN is required for upstream action verification.')

async function workflowFiles(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await workflowFiles(path)))
    else if (/\.ya?ml$/u.test(entry.name)) result.push(path)
  }
  return result
}

const references = new Set()
for (const path of await workflowFiles('.github/workflows')) {
  const source = await readFile(path, 'utf8')
  for (const match of source.matchAll(/uses:\s*([^\s#]+)@([0-9a-f]{40})(?:\s|$)/gu)) {
    if (!match[1].startsWith('./')) references.add(`${match[1]}@${match[2]}`)
  }
}
if (references.size === 0) throw new Error('No pinned action references were found.')

for (const reference of [...references].sort()) {
  const separator = reference.lastIndexOf('@')
  const repository = reference.slice(0, separator).split('/').slice(0, 2).join('/')
  const sha = reference.slice(separator + 1)
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${sha}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok)
    throw new Error(`${reference} is not a valid upstream commit: HTTP ${response.status}.`)
  const commit = await response.json()
  if (commit.sha !== sha) throw new Error(`${reference} resolved to ${commit.sha}.`)
  console.log(`Verified ${reference}.`)
}
