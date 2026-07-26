/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 * Rewritten to retain logical IDs, canonical nullability, explicit indexes,
 * ordered compound indexes, and a deterministic adapter metadata descriptor.
 */
import type { BetterAuthDBSchema, DBFieldAttribute, DBTableIndex } from 'better-auth/db'

import {
  fingerprintAuthSchemaModels,
  type AuthFieldKind,
  type AuthFieldMetadata,
  type AuthIndexMetadata,
  type AuthModelMetadata,
  type AuthSchemaMetadata,
} from './metadata'

export interface GeneratedAuthSchemaArtifacts {
  metadata: AuthSchemaMetadata
  metadataCode: string
  schemaCode: string
}

interface AuthIndexDeclaration {
  fields: readonly string[]
  name?: string
  unique?: true
}

const explicitIndexes: Readonly<Record<string, readonly AuthIndexDeclaration[]>> = {
  invitation: [
    { fields: ['email', 'organizationId', 'status'] },
    { fields: ['organizationId', 'status', 'createdAt'] },
  ],
  member: [{ fields: ['organizationId', 'userId'], unique: true }],
  oauthConsent: [{ fields: ['clientId', 'userId'] }],
  rateLimit: [{ fields: ['key'] }],
  session: [{ fields: ['expiresAt'] }, { fields: ['userId', 'expiresAt'] }],
  teamMember: [{ fields: ['teamId', 'userId'], unique: true }],
  verification: [
    { fields: ['expiresAt'] },
    { fields: ['identifier'] },
    { fields: ['identifier', 'createdAt'] },
  ],
}
function physicalFieldName(logicalName: string, field: DBFieldAttribute): string {
  return field.fieldName ?? logicalName
}

function fieldKind(field: DBFieldAttribute): AuthFieldKind {
  const kind = field.type as AuthFieldKind
  if (
    kind !== 'string' &&
    kind !== 'number' &&
    kind !== 'boolean' &&
    kind !== 'date' &&
    kind !== 'json' &&
    kind !== 'string[]' &&
    kind !== 'number[]'
  ) {
    throw new Error(`AUTH_SCHEMA_UNSUPPORTED_FIELD_TYPE:${String(field.type)}`)
  }
  return kind
}

function validatorForKind(kind: AuthFieldKind): string {
  switch (kind) {
    case 'string':
    case 'json':
      return 'v.string()'
    case 'number':
    case 'date':
      return 'v.number()'
    case 'boolean':
      return 'v.boolean()'
    case 'string[]':
      return 'v.array(v.string())'
    case 'number[]':
      return 'v.array(v.number())'
  }
}

function descriptorFor(fields: readonly string[]): string {
  if (fields.length === 0) throw new Error('AUTH_SCHEMA_EMPTY_INDEX')
  return fields.join('_')
}

function buildIndexes(
  logicalModelName: string,
  fields: Readonly<Record<string, AuthFieldMetadata>>,
  tableIndexes: readonly DBTableIndex[],
): AuthIndexMetadata[] {
  const indexes: AuthIndexMetadata[] = []
  const seenDescriptors = new Set<string>()
  const indexesByFields = new Map<string, AuthIndexMetadata>()

  const add = (logicalFields: readonly string[], unique = false, name?: string) => {
    const physicalFields = logicalFields.map((logicalField) => {
      const field = Object.values(fields).find(
        (candidate) => candidate.logicalName === logicalField,
      )
      if (!field)
        throw new Error(`AUTH_SCHEMA_INDEX_UNKNOWN_FIELD:${logicalModelName}.${logicalField}`)
      return field.physicalName
    })
    const fieldKey = JSON.stringify(physicalFields)
    const existing = indexesByFields.get(fieldKey)
    if (existing) {
      if (unique) existing.unique = true
      return
    }
    const descriptor = name ?? descriptorFor(physicalFields)
    if (seenDescriptors.has(descriptor)) {
      throw new Error(`AUTH_SCHEMA_INDEX_NAME_COLLISION:${logicalModelName}.${descriptor}`)
    }
    seenDescriptors.add(descriptor)
    const index: AuthIndexMetadata = {
      descriptor,
      fields: physicalFields,
      ...(unique ? { unique: true } : {}),
    }
    indexesByFields.set(fieldKey, index)
    indexes.push(index)
  }

  add(['id'], true)
  for (const declared of tableIndexes) {
    add(declared.fields, declared.unique === true, declared.name)
  }
  for (const declared of explicitIndexes[logicalModelName] ?? []) {
    add(declared.fields, declared.unique === true, declared.name)
  }
  for (const field of Object.values(fields)) {
    if (
      field.indexed ||
      field.unique ||
      field.reference ||
      field.sortable ||
      field.physicalName === 'createdAt'
    ) {
      add([field.logicalName], field.unique)
    }
  }
  return indexes
}

function buildMetadata(tables: BetterAuthDBSchema): AuthSchemaMetadata {
  const models: Record<string, AuthModelMetadata> = {}
  const tableByPhysicalName = new Map(
    Object.values(tables).map((table) => [table.modelName, table] as const),
  )
  for (const [logicalModelName, table] of Object.entries(tables)) {
    const physicalModelName = table.modelName
    if (models[physicalModelName]) {
      throw new Error(`AUTH_SCHEMA_DUPLICATE_MODEL:${physicalModelName}`)
    }

    const fields: Record<string, AuthFieldMetadata> = {
      id: {
        logicalName: 'id',
        physicalName: 'id',
        kind: 'string',
        nullable: false,
        required: true,
        indexed: true,
        selectable: true,
        sortable: false,
        unique: true,
        updatable: false,
      },
    }

    for (const [logicalFieldName, rawField] of Object.entries(table.fields)) {
      if (logicalFieldName === 'id') continue
      const field = rawField as DBFieldAttribute
      const physicalName = physicalFieldName(logicalFieldName, field)
      if (fields[physicalName]) {
        throw new Error(`AUTH_SCHEMA_DUPLICATE_FIELD:${physicalModelName}.${physicalName}`)
      }
      let reference: AuthFieldMetadata['reference']
      if (field.references) {
        const referencedTable = tableByPhysicalName.get(field.references.model)
        if (!referencedTable) {
          throw new Error(
            `AUTH_SCHEMA_REFERENCE_MODEL_UNKNOWN:${physicalModelName}.${physicalName}`,
          )
        }
        const referencedRawField =
          field.references.field === 'id'
            ? undefined
            : (referencedTable.fields[field.references.field] as DBFieldAttribute | undefined)
        if (field.references.field !== 'id' && !referencedRawField) {
          throw new Error(
            `AUTH_SCHEMA_REFERENCE_FIELD_UNKNOWN:${physicalModelName}.${physicalName}`,
          )
        }
        const onDelete = field.references.onDelete ?? 'cascade'
        if (onDelete === 'set default' || onDelete === 'no action') {
          throw new Error(
            `AUTH_SCHEMA_REFERENCE_DELETE_UNSUPPORTED:${physicalModelName}.${physicalName}:${onDelete}`,
          )
        }
        if (onDelete === 'set null' && field.required === true) {
          throw new Error(
            `AUTH_SCHEMA_REFERENCE_SET_NULL_REQUIRED:${physicalModelName}.${physicalName}`,
          )
        }
        reference = {
          model: referencedTable.modelName,
          field:
            field.references.field === 'id'
              ? 'id'
              : physicalFieldName(field.references.field, referencedRawField!),
          onDelete,
        }
      }
      fields[physicalName] = {
        logicalName: logicalFieldName,
        physicalName,
        kind: fieldKind(field),
        nullable: field.required !== true,
        required: field.required === true,
        indexed: field.index === true,
        selectable: true,
        sortable: field.sortable === true,
        unique: field.unique === true,
        updatable: true,
        ...(reference ? { reference } : {}),
      }
    }

    models[physicalModelName] = {
      logicalName: logicalModelName,
      physicalName: physicalModelName,
      fields,
      indexes: buildIndexes(logicalModelName, fields, table.indexes ?? []),
    }
  }
  for (const model of Object.values(models)) {
    for (const field of Object.values(model.fields)) {
      if (!field.reference) continue
      const referencedModel = models[field.reference.model]
      const referencedField = referencedModel?.fields[field.reference.field]
      if (!referencedModel || !referencedField) {
        throw new Error(
          `AUTH_SCHEMA_REFERENCE_TARGET_UNKNOWN:${model.physicalName}.${field.physicalName}`,
        )
      }
      if (
        !referencedModel.indexes.some(
          (index) => index.fields.length === 1 && index.fields[0] === referencedField.physicalName,
        )
      ) {
        throw new Error(
          `AUTH_SCHEMA_REFERENCE_TARGET_UNINDEXED:${model.physicalName}.${field.physicalName}`,
        )
      }
    }
  }
  return { fingerprint: fingerprintAuthSchemaModels(models), models }
}

function renderString(value: string): string {
  let escaped = ''
  for (const character of value) {
    switch (character) {
      case '\\':
        escaped += '\\\\'
        break
      case "'":
        escaped += "\\'"
        break
      case '\b':
        escaped += '\\b'
        break
      case '\f':
        escaped += '\\f'
        break
      case '\n':
        escaped += '\\n'
        break
      case '\r':
        escaped += '\\r'
        break
      case '\t':
        escaped += '\\t'
        break
      case '\u2028':
        escaped += '\\u2028'
        break
      case '\u2029':
        escaped += '\\u2029'
        break
      default: {
        const codePoint = character.codePointAt(0)!
        escaped += codePoint <= 31 ? `\\u${codePoint.toString(16).padStart(4, '0')}` : character
      }
    }
  }
  return `'${escaped}'`
}

function renderPropertyName(value: string): string {
  return /^[A-Z_$][\w$]*$/iu.test(value) ? value : renderString(value)
}

function renderValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') return renderString(value)
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => renderValue(item, depth)).join(', ')}]`
    }
    const indentation = '  '.repeat(depth)
    const itemIndentation = '  '.repeat(depth + 1)
    return `[\n${value.map((item) => `${itemIndentation}${renderValue(item, depth + 1)},`).join('\n')}\n${indentation}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const indentation = '  '.repeat(depth)
    const propertyIndentation = '  '.repeat(depth + 1)
    return `{\n${entries
      .map(
        ([key, item]) =>
          `${propertyIndentation}${renderPropertyName(key)}: ${renderValue(item, depth + 1)},`,
      )
      .join('\n')}\n${indentation}}`
  }
  throw new Error('AUTH_SCHEMA_UNSUPPORTED_METADATA_VALUE')
}

function renderMetadata(metadata: AuthSchemaMetadata): string {
  return [
    '/** This file is generated by Better Convex Nuxt. Do not edit. */',
    `const schemaMetadata = ${renderValue(metadata)} as const`,
    '',
    'export default schemaMetadata',
    '',
  ].join('\n')
}

function renderSchema(metadata: AuthSchemaMetadata): string {
  const models = Object.values(metadata.models)
  const renderedModels = models.map((model) => {
    const fields = Object.values(model.fields)
      .map((field) => {
        const validator = validatorForKind(field.kind)
        return `    ${renderPropertyName(field.physicalName)}: ${field.nullable ? `v.union(v.null(), ${validator})` : validator},`
      })
      .join('\n')
    const indexCalls = model.indexes.map(
      (index) => `.index(${renderString(index.descriptor)}, ${renderValue(index.fields)})`,
    )
    const indexes =
      indexCalls.length === 1 && `  })${indexCalls[0]},`.length <= 100
        ? indexCalls[0]
        : indexCalls.map((call) => `\n    ${call}`).join('')
    return `  ${renderPropertyName(model.physicalName)}: defineTable({\n${fields}\n  })${indexes},`
  })

  return [
    '/** This file is generated by Better Convex Nuxt. Do not edit. */',
    "import { defineSchema, defineTable } from 'convex/server'",
    "import { v } from 'convex/values'",
    '',
    'export const tables = {',
    ...renderedModels,
    '} as const',
    '',
    'const schema = defineSchema(tables)',
    `Object.defineProperty(schema, '__betterConvexNuxtAuthSchemaFingerprint', {`,
    `  value: ${renderString(metadata.fingerprint)},`,
    '})',
    '',
    'export default schema',
    '',
  ].join('\n')
}

export function generateAuthSchemaArtifacts(
  tables: BetterAuthDBSchema,
): GeneratedAuthSchemaArtifacts {
  const metadata = buildMetadata(tables)
  return {
    metadata,
    metadataCode: renderMetadata(metadata),
    schemaCode: renderSchema(metadata),
  }
}

export async function createAuthSchema({
  file,
  tables,
}: {
  file?: string
  tables: BetterAuthDBSchema
}) {
  const artifacts = generateAuthSchemaArtifacts(tables)
  const target = file ?? './schema.ts'
  return {
    code: artifacts.schemaCode,
    path: target,
    overwrite: true,
  }
}
