import type { BetterAuthOptions } from 'better-auth'
import { getAuthTables } from 'better-auth/db'
import { twoFactor } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

import { generateAuthSchemaArtifacts } from '../../src/runtime/convex-auth/adapter/generate-schema'
import {
  hasWorkforceSchema,
  workforceSchemaOptions,
  workforceSchemaPlugin,
} from '../../src/runtime/convex-auth/workforce/schema'

function metadata(options: BetterAuthOptions = workforceSchemaOptions) {
  return generateAuthSchemaArtifacts(
    getAuthTables({ plugins: [twoFactor(), workforceSchemaPlugin], ...options }),
  ).metadata
}

describe('workforce schema ownership', () => {
  it('leaves ordinary auth schemas unchanged and recognizes the complete owned contract', () => {
    expect(hasWorkforceSchema(metadata({ plugins: [twoFactor()] }))).toBe(false)
    expect(hasWorkforceSchema(metadata())).toBe(true)
  })

  it('keeps all proof fields server-assigned and out of public output', () => {
    for (const model of Object.values(workforceSchemaOptions)) {
      for (const field of Object.values(model.additionalFields)) {
        expect(field.input).toBe(false)
        expect(field.returned).toBe(false)
      }
    }
    for (const field of Object.values(workforceSchemaPlugin.schema.twoFactor.fields)) {
      expect(field).toMatchObject({ required: false, input: false, returned: false })
      expect(field).not.toHaveProperty('defaultValue')
    }
  })

  it('merges pending fields without replacing the canonical factor schema', () => {
    const fields = metadata().models.twoFactor!.fields
    expect(fields.secret).toMatchObject({ kind: 'string', required: true })
    expect(fields.backupCodes).toMatchObject({ kind: 'string', required: true })
    for (const [name, expected] of Object.entries(workforceSchemaPlugin.schema.twoFactor.fields)) {
      expect(fields[name]).toMatchObject({
        kind: expected.type,
        required: false,
        nullable: true,
      })
    }
  })

  it('rejects omission of the pending schema plugin and a pending-only contract', () => {
    expect(() =>
      hasWorkforceSchema(metadata({ ...workforceSchemaOptions, plugins: [twoFactor()] })),
    ).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
    expect(() => hasWorkforceSchema(metadata({}))).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
  })

  it.each(Object.keys(workforceSchemaPlugin.schema.twoFactor.fields))(
    'rejects missing or weakened %s pending metadata',
    (name) => {
      const original = metadata()
      const factor = original.models.twoFactor!
      const field = factor.fields[name]!
      for (const change of [
        { ...field, kind: 'boolean' as const },
        { ...field, required: true, nullable: false },
        { ...field, physicalName: `renamed${name}` },
      ]) {
        expect(() =>
          hasWorkforceSchema({
            ...original,
            models: {
              ...original.models,
              twoFactor: { ...factor, fields: { ...factor.fields, [name]: change } },
            },
          }),
        ).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
      }
      const fields = { ...factor.fields }
      Reflect.deleteProperty(fields, name)
      expect(() =>
        hasWorkforceSchema({
          ...original,
          models: { ...original.models, twoFactor: { ...factor, fields } },
        }),
      ).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
    },
  )

  it.each(['session', 'verification'] as const)('rejects the missing %s proof model', (name) => {
    const options = { ...workforceSchemaOptions }
    Reflect.deleteProperty(options, name)
    expect(() => hasWorkforceSchema(metadata(options))).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
  })

  it('rejects a remapped canonical model', () => {
    const original = metadata()
    const renamed = {
      ...original,
      models: {
        ...original.models,
        user: { ...original.models.user!, logicalName: 'renamedUser' },
      },
    }
    expect(() => hasWorkforceSchema(renamed)).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
  })

  it('requires the canonical factor model and credential fields', () => {
    expect(() => hasWorkforceSchema(metadata({ ...workforceSchemaOptions, plugins: [] }))).toThrow(
      'AUTH_WORKFORCE_SCHEMA_MISMATCH',
    )
    const original = metadata()
    const account = original.models.account!
    expect(() =>
      hasWorkforceSchema({
        ...original,
        models: {
          ...original.models,
          account: {
            ...account,
            fields: {
              ...account.fields,
              password: { ...account.fields.password!, physicalName: 'renamedPassword' },
            },
          },
        },
      }),
    ).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
  })

  it('rejects remapped fields and partial field definitions', () => {
    expect(() =>
      hasWorkforceSchema(
        metadata({
          ...workforceSchemaOptions,
          user: {
            additionalFields: {
              bcnSecurityGeneration: {
                ...workforceSchemaOptions.user.additionalFields.bcnSecurityGeneration,
                fieldName: 'renamedGeneration',
              },
            },
          },
        }),
      ),
    ).toThrow('AUTH_SCHEMA_SESSION_GENERATION_FIELD_RESERVED')
    expect(() =>
      hasWorkforceSchema(
        metadata({
          ...workforceSchemaOptions,
          session: { additionalFields: {} },
        }),
      ),
    ).toThrow('AUTH_WORKFORCE_SCHEMA_MISMATCH')
  })

  it('rejects weakened field types and nullability', () => {
    for (const change of [{ type: 'string' as const }, { required: false }]) {
      expect(() =>
        hasWorkforceSchema(
          metadata({
            ...workforceSchemaOptions,
            user: {
              additionalFields: {
                bcnSecurityGeneration: {
                  ...workforceSchemaOptions.user.additionalFields.bcnSecurityGeneration,
                  ...change,
                },
              },
            },
          }),
        ),
      ).toThrow('AUTH_SCHEMA_SESSION_GENERATION_FIELD_RESERVED')
    }
  })
})
