import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const convexCli = path.join(root, 'node_modules/convex/bin/main.js')
const localBrowserSources = ['starters/team/scripts/verify-browser-happy-path.mjs'] as const

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('Convex CLI authority boundaries', () => {
  it('passes Convex-owned --env-file flags beyond the Node option boundary', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bcn-convex-cli-authority-'))
    const envFile = path.join(directory, '.env.local')
    const ambientCredential = 'must-not-select-an-ambient-deployment'
    writeFileSync(envFile, '', { encoding: 'utf8', mode: 0o600 })

    try {
      const result = spawnSync(
        process.execPath,
        ['--', convexCli, 'env', 'list', '--env-file', envFile],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, CONVEX_DEPLOY_KEY: ambientCredential },
          timeout: 10_000,
        },
      )
      const output = `${result.stdout}\n${result.stderr}`
      expect(result.status).not.toBe(0)
      expect(output).toContain('did not contain environment variables for a Convex deployment')
      expect(output).not.toContain(ambientCredential)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('strips all Convex authority from disposable fixture subprocesses', () => {
    for (const relativePath of [
      'scripts/mcp-evidence-fixture.mjs',
      'scripts/mcp-local-fixture.mjs',
      'scripts/run-auth-export-sentinels.mjs',
    ]) {
      expect(source(relativePath), relativePath).toMatch(
        /toUpperCase\(\)[\s\S]{0,200}startsWith\('CONVEX_'\)/u,
      )
    }
  })

  it('sends deployment secrets over stdin instead of exposing them in process arguments', () => {
    const localHelper = source('test/helpers/local-convex.ts')
    const localFixture = source('scripts/mcp-local-fixture.mjs')
    expect(localHelper).toContain('child.stdin.end(`${value}\\n`)')
    expect(localFixture).toContain("runCli(['env', 'set', name], value)")
    expect(localFixture).not.toContain("runCli(['env', 'set', name, value])")

    for (const relativePath of localBrowserSources) {
      const value = source(relativePath)
      expect(value, relativePath).toContain(
        'child.stdin.end(options.input === undefined ? undefined : `${options.input}\\n`)',
      )
      expect(value, relativePath).toMatch(
        /input: (?:authSecrets|process\.env\.BETTER_AUTH_SECRETS \?\? defaultAuthSecrets)/u,
      )
      expect(value, relativePath).toContain('delete env.BETTER_AUTH_SECRETS')
    }
  })
})
