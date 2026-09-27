import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

// The Convex session token carries only library claims by default. Profile
// fields on `ConvexUser` (name, email, image, emailVerified) exist only when
// the app returns them from `defineSessionClaims`. Samples that read them
// without showing that prerequisite render `undefined` in a default app.

const repoRoot = join(import.meta.dirname, '../..')
const docsRoot = join(repoRoot, 'docs/content')
const profileRead = /\buser(?:\.value)?\??\.(?:name|email|image|emailVerified)\b/
const idFallback = /\buser(?:\.value)?\??\.id\b/

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

function codeBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1] ?? '')
}

const docs = markdownFiles(docsRoot).map((path) => {
  const source = readFileSync(path, 'utf8')
  const blocks = codeBlocks(source)
  return {
    path: relative(repoRoot, path),
    source,
    blocks,
    // A page that shows the `defineSessionClaims` prerequisite in a sample may
    // read the fields it adds.
    showsSessionClaims: blocks.some((block) => block.includes('defineSessionClaims')),
  }
})

describe('session-token user samples', () => {
  it('finds the documentation pages', () => {
    expect(docs.length).toBeGreaterThan(20)
  })

  it('do not read profile claims from getConvexUser/requireConvexUser without defineSessionClaims', () => {
    const offenders = docs.flatMap(({ path, blocks, showsSessionClaims }) =>
      showsSessionClaims
        ? []
        : blocks
            .filter((block) => /\b(?:get|require)ConvexUser\(/.test(block))
            .filter((block) => profileRead.test(block))
            .map(() => path),
    )

    expect(offenders).toEqual([])
  })

  it('fall back to the user ID when a useConvexAuth template shows profile claims', () => {
    const offenders = docs.flatMap(({ path, blocks, showsSessionClaims }) =>
      showsSessionClaims
        ? []
        : blocks
            .filter((block) => block.includes('<template>'))
            .flatMap((block) => [...block.matchAll(/\{\{([\s\S]*?)\}\}/g)])
            .map((match) => match[1] ?? '')
            .filter((expression) => profileRead.test(expression) && !idFallback.test(expression))
            .map((expression) => `${path}: {{${expression}}}`),
    )

    expect(offenders).toEqual([])
  })

  it('states in the Nitro user reference that profile fields depend on defineSessionClaims', () => {
    const reference = readFileSync(
      join(repoRoot, 'docs/content/docs/7.reference/3.server-api.md'),
      'utf8',
    )
    const start = reference.indexOf('### `getConvexUser`')
    const end = reference.indexOf('### `toConvexH3Error`')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const section = reference.slice(start, end)
    expect(section).toContain('defineSessionClaims')
  })
})
