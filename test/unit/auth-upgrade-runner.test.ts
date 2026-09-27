import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertPinnedDeployment,
  convexDevArguments,
  push,
} from '../../scripts/run-auth-upgrade.mjs'

const reviewed = 'precompiled-2026-07-06-44f7aa7'
const pin = { version: reviewed, cloudPort: 41_001, sitePort: 41_002 }
const directories: string[] = []

function deployment(backendVersion?: string): string {
  const app = mkdtempSync(path.join(tmpdir(), 'bcn-auth-upgrade-runner-'))
  directories.push(app)
  if (backendVersion) writeConfig(app, backendVersion)
  return app
}

function writeConfig(app: string, backendVersion: string): void {
  const directory = path.join(app, '.convex/local/default')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ backendVersion }))
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

describe('auth upgrade runner', () => {
  it('pins the reviewed backend and ports on every push, with or without extra arguments', () => {
    for (const extra of [[], ['--run', 'upgrade:verifyUpgrade']]) {
      const args = convexDevArguments(pin, extra)
      expect(args.slice(0, 2)).toEqual(['dev', '--once'])
      expect(flag(args, '--local-backend-version')).toBe(reviewed)
      expect(flag(args, '--local-cloud-port')).toBe('41001')
      expect(flag(args, '--local-site-port')).toBe('41002')
      expect(args.slice(args.length - extra.length)).toEqual(extra)
    }
    expect(() => convexDevArguments({ ...pin, version: '' })).toThrow(/reviewed backend version/u)
    expect(() => convexDevArguments({ version: reviewed })).toThrow(/both local ports/u)
  })

  it('sends the pin through push, including pushes that expect a schema failure', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = deployment(reviewed)
    const calls: string[][] = []
    const run = (_node: string, args: string[]) => {
      calls.push(args)
      return { status: 1, stdout: '', stderr: 'Schema validation failed' }
    }

    expect(push(app, pin, 'control', [], run)).toMatchObject({ ok: false })
    expect(push(app, pin, 'upgrade', ['--run', 'upgrade:verifyUpgrade'], run).ok).toBe(false)
    expect(calls).toHaveLength(2)
    for (const args of calls) {
      expect(flag(args, '--local-backend-version')).toBe(reviewed)
      expect(flag(args, '--local-cloud-port')).toBe('41001')
    }
  })

  it('fails a push that left the deployment on another backend, as a CLI upgrade would', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = deployment(reviewed)
    const upgraded = () => {
      writeConfig(app, 'precompiled-2026-09-01-latest')
      return { status: 0, stdout: '{"upgrade":"passed"}', stderr: 'Pushed' }
    }

    expect(() => push(app, pin, 'upgrade', [], upgraded)).toThrow(
      /runs backend "precompiled-2026-09-01-latest", not the reviewed precompiled-2026-07-06-44f7aa7[\s\S]*Pushed/u,
    )
  })

  it('fails closed when the deployment config is missing or names another version', () => {
    expect(() => assertPinnedDeployment(deployment(), reviewed)).toThrow(
      /no local deployment config/u,
    )
    expect(() => assertPinnedDeployment(deployment('other'), reviewed)).toThrow(/not the reviewed/u)
    expect(() => assertPinnedDeployment(deployment(reviewed), reviewed)).not.toThrow()
  })
})
