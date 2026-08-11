import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('old auth runtime gate', () => {
  it('ignores tool-owned worktrees outside the authoritative checkout', () => {
    const checker = readFileSync(resolve(root, 'scripts/check-no-old-auth-runtime.mjs'), 'utf8')

    expect(checker).toContain("'.claude',")
    expect(checker).toContain('walk(root)')
    expect(checker).toContain(
      `const removedPackage = '${['@convex-dev', 'better-auth'].join('/')}'`,
    )
  })
})
