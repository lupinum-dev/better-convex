import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const pagesDirectory = join(root, 'docs/content/docs/2.get-started')
const starter = join(root, 'starters/tutorial')
// The tutorial pages in reading order. Each later page may replace a file an earlier one wrote.
const pages = [
  '2.installation.md',
  '3.first-realtime-page.md',
  '4.complete-and-delete.md',
  '5.add-authentication.md',
  '6.protect-data.md',
]
// Shown as an excerpt or written by a tool, so not compared whole.
const excerpts = new Set(['package.json'])

/** The last version of each file the tutorial shows, by path. */
function finalTutorialFiles(): Map<string, string> {
  const files = new Map<string, string>()
  for (const page of pages) {
    const source = readFileSync(join(pagesDirectory, page), 'utf8')
    for (const match of source.matchAll(/^```\w+ \[([^\]]+)\]\n([\s\S]*?)^```$/gmu)) {
      const [, path, contents] = match
      if (!excerpts.has(path!)) files.set(path!, contents!)
    }
  }
  return files
}

// Catches a tutorial page and the starter drifting apart: CI typechecks, builds and tests the
// starter, so the code a reader pastes from the last version of each file is known to work.
test('the last version of each tutorial file is the file in starters/tutorial', () => {
  const files = finalTutorialFiles()
  expect([...files.keys()].sort()).toEqual([
    'app/app.vue',
    'app/convex-auth.ts',
    'app/pages/index.vue',
    'app/pages/todos.vue',
    'convex/auth.ts',
    'convex/schema.ts',
    'convex/todos.ts',
    'nuxt.config.ts',
  ])
  for (const [path, contents] of files) {
    expect(readFileSync(join(starter, path), 'utf8'), path).toBe(contents)
  }
  expect(readdirSync(pagesDirectory)).toEqual(expect.arrayContaining(pages))
})
