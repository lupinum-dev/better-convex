import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const begin = '<!-- BEGIN:consumer-onboarding -->'
const end = '<!-- END:consumer-onboarding -->'

function bounds(source) {
  if (
    source.split(begin).length !== 2 ||
    source.split(end).length !== 2 ||
    source.indexOf(begin) > source.indexOf(end)
  ) {
    throw new Error('Expected exactly one ordered consumer onboarding block.')
  }
  return [source.indexOf(begin), source.indexOf(end) + end.length]
}

const source = await readFile(
  resolve(root, 'docs/content/docs/3.get-started/1.choose-your-path.md'),
  'utf8',
)
const [start, finish] = bounds(source)
const block = source.slice(start, finish)

for (const relativePath of ['README.md', 'packages/vue/README.md', 'packages/mcp/README.md']) {
  const path = resolve(root, relativePath)
  const current = await readFile(path, 'utf8')
  const [from, to] = bounds(current)
  if (process.argv.includes('--write')) {
    await writeFile(path, current.slice(0, from) + block + current.slice(to))
  } else if (current.slice(from, to) !== block) {
    throw new Error(`${relativePath} onboarding is stale. Run pnpm docs:onboarding.`)
  }
}
