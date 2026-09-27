import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkSourceSchemas } from '../../scripts/check-auth-schema.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))

// A real source snapshot shares the installed dependencies, but owns its source files.
// Running pnpm exec here would attempt to manage an installation outside this root.
function withSnapshot(check: (snapshot: string) => void) {
  const snapshot = mkdtempSync(path.join(tmpdir(), 'bcn-schema-snapshot-test-'))
  try {
    for (const relative of [
      'package.json',
      'scripts/generate-auth-schema.mjs',
      'src',
      'internal/convex-auth',
      'starters/team/convex/betterAuth',
      'test/fixtures/better-auth-local-component/convex/betterAuth',
      'test/fixtures/better-auth-two-factor/convex/betterAuth',
    ]) {
      const target = path.join(snapshot, relative)
      mkdirSync(path.dirname(target), { recursive: true })
      cpSync(path.join(root, relative), target, { recursive: true })
    }
    symlinkSync(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir')
    check(snapshot)
  } finally {
    rmSync(snapshot, { recursive: true, force: true })
  }
}

describe('auth schema source snapshot', () => {
  it('checks with the installed Node runtime without claiming ownership of shared dependencies', () => {
    withSnapshot((snapshot) => {
      const target = path.join(snapshot, 'starters/team/convex/betterAuth/schema.ts')
      const before = readFileSync(target)
      expect(() => checkSourceSchemas(snapshot)).not.toThrow()
      expect(readFileSync(target)).toEqual(before)
    })
  }, 30_000)

  it('rejects stale schema in the snapshot and leaves the source and snapshot unchanged', () => {
    const relative = 'starters/team/convex/betterAuth/schema.ts'
    const original = readFileSync(path.join(root, relative))
    withSnapshot((snapshot) => {
      const target = path.join(snapshot, relative)
      writeFileSync(target, 'stale schema\n')
      expect(() => checkSourceSchemas(snapshot)).toThrow('stale:')
      expect(readFileSync(target, 'utf8')).toBe('stale schema\n')
      expect(readFileSync(path.join(root, relative))).toEqual(original)
    })
  }, 30_000)
})
