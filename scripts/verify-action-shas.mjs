import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

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
  for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*(['"]?)([^'"\s#]+)\1(?:\s+#.*)?$/gmu)) {
    const value = match[2]
    if (value.startsWith('./')) continue
    const separator = value.lastIndexOf('@')
    const sha = value.slice(separator + 1)
    if (separator < 1 || !/^[0-9a-f]{40}$/u.test(sha)) {
      throw new Error(`${path}: external action must use a full commit SHA: ${value}`)
    }
    references.add(value)
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
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(`${reference} is not a valid upstream commit: HTTP ${response.status}.`)
  const commit = await response.json()
  if (commit.sha !== sha) throw new Error(`${reference} resolved to ${commit.sha}.`)
  console.log(`Verified ${reference}.`)
}
