import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'

import type { AuthSchemaMetadata } from '../adapter/metadata'

/** One field definition for runtime construction and build-time generation. */
export const workforceSchemaOptions = {
  user: {
    additionalFields: {
      bcnSecurityGeneration: {
        type: 'number',
        required: true,
        defaultValue: 0,
        input: false,
        returned: false,
      },
    },
  },
  session: {
    additionalFields: {
      bcnAssuranceGeneration: {
        type: 'number',
        required: true,
        defaultValue: -1,
        input: false,
        returned: false,
      },
      bcnAssuranceMethod: {
        type: 'string',
        required: true,
        defaultValue: 'none',
        input: false,
        returned: false,
      },
      bcnAuthenticatedAt: {
        type: 'number',
        required: true,
        defaultValue: 0,
        input: false,
        returned: false,
      },
      bcnSessionStartedAt: {
        type: 'number',
        required: true,
        defaultValue: 0,
        input: false,
        returned: false,
      },
    },
  },
  verification: {
    additionalFields: {
      bcnAssuranceGeneration: {
        type: 'number',
        required: false,
        input: false,
        returned: false,
      },
    },
  },
} as const satisfies Pick<BetterAuthOptions, 'user' | 'session' | 'verification'>

/** Merge after twoFactor(); keep the active credential until pending proof succeeds. */
export const workforceSchemaPlugin = {
  id: 'bcn-workforce-schema',
  schema: {
    twoFactor: {
      fields: {
        bcnPendingSecret: { type: 'string', required: false, input: false, returned: false },
        bcnPendingBackupCodes: { type: 'string', required: false, input: false, returned: false },
        bcnPendingSessionId: { type: 'string', required: false, input: false, returned: false },
        bcnPendingGeneration: { type: 'number', required: false, input: false, returned: false },
      },
    },
  },
} as const satisfies BetterAuthPlugin

const workforceFields = {
  user: workforceSchemaOptions.user.additionalFields,
  session: workforceSchemaOptions.session.additionalFields,
  verification: workforceSchemaOptions.verification.additionalFields,
  twoFactor: workforceSchemaPlugin.schema.twoFactor.fields,
}

/** Reject partial or remapped proof contracts; ordinary auth schemas are unchanged. */
export function hasWorkforceSchema(metadata: AuthSchemaMetadata): boolean {
  const reservedNames = new Set(Object.values(workforceFields).flatMap(Object.keys))
  const present = Object.values(metadata.models).some((model) =>
    Object.values(model.fields).some(
      (field) => reservedNames.has(field.logicalName) || reservedNames.has(field.physicalName),
    ),
  )
  if (!present) return false

  for (const name of ['user', 'session', 'verification', 'account', 'twoFactor']) {
    const model = metadata.models[name]
    if (
      !model ||
      model.logicalName !== name ||
      model.physicalName !== name ||
      Object.values(model.fields).some((field) => field.logicalName !== field.physicalName)
    ) {
      throw new Error('AUTH_WORKFORCE_SCHEMA_MISMATCH')
    }
  }

  for (const [modelName, fields] of Object.entries(workforceFields)) {
    const model = metadata.models[modelName]
    if (!model || model.logicalName !== modelName || model.physicalName !== modelName) {
      throw new Error('AUTH_WORKFORCE_SCHEMA_MISMATCH')
    }
    for (const [name, expected] of Object.entries(fields)) {
      const field = model.fields[name]
      if (
        !field ||
        field.logicalName !== name ||
        field.physicalName !== name ||
        field.kind !== expected.type ||
        field.required !== expected.required ||
        field.nullable === expected.required ||
        field.reference ||
        field.unique
      ) {
        throw new Error('AUTH_WORKFORCE_SCHEMA_MISMATCH')
      }
    }
  }
  return true
}
