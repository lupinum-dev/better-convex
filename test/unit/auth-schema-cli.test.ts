import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAuthTables } from 'better-auth/db'
import { describe, expect, it } from 'vitest'

import { generateAuthSchemaArtifacts } from '../../src/runtime/convex-auth/adapter/generate-schema'
import schemaOptions from '../fixtures/better-auth-two-factor/convex/betterAuth/schemaOptions'

const root = fileURLToPath(new URL('../..', import.meta.url))
const jiti = fileURLToPath(new URL('../../node_modules/jiti/lib/jiti-cli.mjs', import.meta.url))
const cli = 'src/runtime/cli/auth-schema.ts'
const twoFactorDirectory = 'test/fixtures/better-auth-two-factor/convex/betterAuth'

function runCli(config: string, output: string) {
  return spawnSync(
    process.execPath,
    [jiti, cli, '--config', config, '--output', output, '--check'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    },
  )
}

describe('auth schema CLI authority', () => {
  it('renders the exact canonical bytes committed for a reference component', () => {
    const artifacts = generateAuthSchemaArtifacts(getAuthTables(schemaOptions))

    expect(artifacts.schemaCode).toBe(
      readFileSync(`${root}/${twoFactorDirectory}/schema.ts`, 'utf8'),
    )
    expect(artifacts.metadataCode).toBe(
      readFileSync(`${root}/${twoFactorDirectory}/schemaMetadata.ts`, 'utf8'),
    )
  })

  it('checks committed artifacts without writing them', () => {
    const schemaPath = `${root}/${twoFactorDirectory}/schema.ts`
    const metadataPath = `${root}/${twoFactorDirectory}/schemaMetadata.ts`
    const before = [readFileSync(schemaPath), readFileSync(metadataPath)]
    const result = runCli(`${twoFactorDirectory}/schemaOptions.ts`, twoFactorDirectory)

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect([readFileSync(schemaPath), readFileSync(metadataPath)]).toEqual(before)
  })

  it('reports stale artifacts without replacing either half of the pair', () => {
    const output = mkdtempSync(join(tmpdir(), 'bcn-auth-schema-check-'))
    const schemaPath = join(output, 'schema.ts')
    const metadataPath = join(output, 'schemaMetadata.ts')
    const staleSchema = 'stale schema\n'
    const staleMetadata = 'stale metadata\n'
    writeFileSync(schemaPath, staleSchema)
    writeFileSync(metadataPath, staleMetadata)

    try {
      const result = runCli(`${twoFactorDirectory}/schemaOptions.ts`, output)

      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`stale: ${schemaPath}`)
      expect(result.stderr).toContain(`stale: ${metadataPath}`)
      expect(readFileSync(schemaPath, 'utf8')).toBe(staleSchema)
      expect(readFileSync(metadataPath, 'utf8')).toBe(staleMetadata)
    } finally {
      rmSync(output, { force: true, recursive: true })
    }
  })

  it('accepts the documented default-export config form in the Team reference', () => {
    const result = runCli(
      'starters/team/convex/betterAuth/schemaOptions.ts',
      'starters/team/convex/betterAuth',
    )

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })
})
