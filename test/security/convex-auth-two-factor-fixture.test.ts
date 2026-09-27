import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAuthTables } from 'better-auth/db'
import { describe, expect, it } from 'vitest'

import { generateAuthSchemaArtifacts } from '../../src/runtime/convex-auth/adapter/generate-schema'
import schemaOptions from '../fixtures/better-auth-two-factor/convex/betterAuth/schemaOptions'

const root = join(import.meta.dirname, '../..')
const fixture = 'test/fixtures/better-auth-two-factor/convex'

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('dedicated Better Auth two-factor fixture', () => {
  it('keeps the checked-in two-factor schema and metadata on the canonical generator', () => {
    const generated = generateAuthSchemaArtifacts(getAuthTables(schemaOptions))
    const schema = read(`${fixture}/betterAuth/schema.ts`)
    const metadata = read(`${fixture}/betterAuth/schemaMetadata.ts`)

    expect(schema).toContain(`value: '${generated.metadata.fingerprint}'`)
    expect(metadata).toContain(`fingerprint: '${generated.metadata.fingerprint}'`)
    expect(generated.metadata.models.twoFactor).toMatchObject({
      logicalName: 'twoFactor',
      fields: {
        failedVerificationCount: { kind: 'number', nullable: true },
        lockedUntil: { kind: 'date', nullable: true },
        userId: { kind: 'string', nullable: false },
      },
    })
    expect(generated.metadata.models.user?.fields.twoFactorEnabled).toMatchObject({
      kind: 'boolean',
      nullable: true,
    })
    expect(generated.metadata.models.verification?.indexes).toContainEqual({
      descriptor: 'identifier_createdAt',
      fields: ['identifier', 'createdAt'],
    })
  })
})
