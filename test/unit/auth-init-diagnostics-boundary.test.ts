import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('auth initialization diagnostic boundary', () => {
  it('keeps the reporter private, closed, and outside nostics', () => {
    const source = read('src/runtime/convex-auth/create-better-convex-auth.ts')
    const serverEntry = read('src/runtime/convex-auth/index.ts')
    const manifest = read('package.json')

    expect(source).toContain('type AuthInitializationFailureLabel =')
    expect(source).toContain(
      'function reportAuthInitializationFailure(label: AuthInitializationFailureLabel): void',
    )
    expect(source).toContain('console.error(authInitializationFailureLines[label])')
    expect(source).not.toContain('nostics')
    expect(serverEntry).not.toContain('AuthInitializationFailure')
    expect(manifest).not.toContain('AUTH_INIT_')
  })

  it('defines exactly the five approved support labels', () => {
    const source = read('src/runtime/convex-auth/create-better-convex-auth.ts')
    const declared = [...source.matchAll(/^ {2}\| '(BCN_AUTH_INIT_[A-Z_]+)'$/gmu)].map(
      (match) => match[1],
    )

    expect(declared).toEqual([
      'BCN_AUTH_INIT_SITE_ORIGIN_FAILED',
      'BCN_AUTH_INIT_CONVEX_ORIGIN_FAILED',
      'BCN_AUTH_INIT_SECRETS_FAILED',
      'BCN_AUTH_INIT_OAUTH_PROFILE_FAILED',
      'BCN_AUTH_INIT_COMPOSITION_FAILED',
    ])
  })
})
