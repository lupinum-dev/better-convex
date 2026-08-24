import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('historical release policy', () => {
  it('does not retain a workstation bootstrap publication path', () => {
    const workflow = read('.github/workflows/publish-prerelease.yml')
    const releasing = read('RELEASING.md')

    expect(workflow).not.toContain('bootstrap_packages')
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(releasing).not.toMatch(/npm publish .*<channel>/u)
    expect(releasing).toContain('Historical bootstrap publications')
    expect(releasing).toContain('immutable historical exceptions')
  })

  it('requires exact retained evidence for partial-release recovery', () => {
    const reconciler = read('scripts/reconcile-release.mjs')
    const workflow = read('.github/workflows/publish-prerelease.yml')

    expect(reconciler).toContain('exists with different bytes')
    expect(reconciler).toContain('has no verifiable npm provenance')
    expect(workflow).toContain("if (evidence.mode === 'absent')")
    expect(workflow).toContain('rerun the unprivileged verifier')
  })
})
