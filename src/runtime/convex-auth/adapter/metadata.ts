export type AuthFieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'json'
  | 'string[]'
  | 'number[]'

export interface AuthReferenceMetadata {
  model: string
  field: string
  onDelete: 'cascade' | 'restrict' | 'set null'
}

export interface AuthFieldMetadata {
  logicalName: string
  physicalName: string
  kind: AuthFieldKind
  nullable: boolean
  indexed: boolean
  sortable: boolean
  unique: boolean
  updatable: boolean
  /**
   * The Convex column may be absent, so rows written by a release that did not
   * have this field still validate on schema push. The adapter writes it on
   * every new row, so an absent value only ever means an earlier release wrote
   * the row; code that depends on the field must deny such rows.
   */
  optional?: true
  reference?: AuthReferenceMetadata
}

export interface AuthIndexMetadata {
  descriptor: string
  fields: readonly string[]
  unique?: true
}

export interface AuthModelMetadata {
  logicalName: string
  physicalName: string
  fields: Readonly<Record<string, AuthFieldMetadata>>
  indexes: readonly AuthIndexMetadata[]
  /**
   * Columns an earlier release stored that Better Auth no longer defines, by
   * physical name. They are optional in the Convex schema so existing rows
   * still validate; the adapter never writes, reads, filters or indexes them.
   */
  legacyFields?: Readonly<Record<string, AuthFieldKind>>
}

export interface AuthSchemaMetadata {
  fingerprint: string
  models: Readonly<Record<string, AuthModelMetadata>>
}

export const AUTH_SCHEMA_FINGERPRINT_PREFIX = 'bcn-auth-schema-v2:'
const FNV64_OFFSET_BASIS = 14_695_981_039_346_656_037n
const FNV64_PRIME = 1_099_511_628_211n
const AUTH_SCHEMA_FINGERPRINT_PROPERTY = '__betterConvexNuxtAuthSchemaFingerprint'

/** Compute the canonical fingerprint for every runtime-significant metadata field. */
export function fingerprintAuthSchemaModels(models: AuthSchemaMetadata['models']): string {
  let hash = FNV64_OFFSET_BASIS
  for (const codeUnit of JSON.stringify(models)) {
    hash ^= BigInt(codeUnit.charCodeAt(0))
    hash = BigInt.asUintN(64, hash * FNV64_PRIME)
  }
  return `${AUTH_SCHEMA_FINGERPRINT_PREFIX}${hash.toString(16).padStart(16, '0')}`
}

interface ExportedValidator {
  type: string
  value?: ExportedValidator | ExportedValidator[] | Record<string, unknown>
}

interface ExportedField {
  fieldType: ExportedValidator
  optional: boolean
}

interface ExportedTable {
  documentType: {
    type: string
    value: Record<string, ExportedField>
  }
  indexes: Array<{ fields: string[]; indexDescriptor: string }>
  searchIndexes: unknown[]
  stagedDbIndexes: unknown[]
  stagedSearchIndexes: unknown[]
  stagedVectorIndexes: unknown[]
  tableName: string
  vectorIndexes: unknown[]
}

interface ExportedSchema {
  tables: ExportedTable[]
}

function mismatch(): never {
  throw new Error('AUTH_SCHEMA_METADATA_MISMATCH')
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function expectedBaseValidator(kind: AuthFieldKind): ExportedValidator {
  switch (kind) {
    case 'string':
    case 'json':
      return { type: 'string' }
    case 'number':
    case 'date':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'string[]':
      return { type: 'array', value: { type: 'string' } }
    case 'number[]':
      return { type: 'array', value: { type: 'number' } }
  }
}

function validatorMatches(field: AuthFieldMetadata, actual: ExportedValidator): boolean {
  const base = expectedBaseValidator(field.kind)
  const expected = field.nullable ? { type: 'union', value: [{ type: 'null' }, base] } : base
  return JSON.stringify(actual) === JSON.stringify(expected)
}

/**
 * Fail at component definition time when generated schema and metadata are not
 * the exact pair produced by one generator run.
 */
export function assertAuthSchemaMatchesMetadata(
  schema: unknown,
  metadata: AuthSchemaMetadata,
): void {
  try {
    if (schema === null || typeof schema !== 'object') mismatch()
    const schemaRecord = schema as Record<string, unknown>
    const exportSchema = schemaRecord.export
    if (
      typeof exportSchema !== 'function' ||
      typeof metadata.fingerprint !== 'string' ||
      !metadata.fingerprint.startsWith(AUTH_SCHEMA_FINGERPRINT_PREFIX) ||
      metadata.fingerprint.length !== AUTH_SCHEMA_FINGERPRINT_PREFIX.length + 16 ||
      fingerprintAuthSchemaModels(metadata.models) !== metadata.fingerprint ||
      schemaRecord[AUTH_SCHEMA_FINGERPRINT_PROPERTY] !== metadata.fingerprint
    ) {
      mismatch()
    }

    const exported = JSON.parse(exportSchema.call(schema) as string) as ExportedSchema
    if (!exported || !Array.isArray(exported.tables)) mismatch()

    const models = Object.values(metadata.models)
    const cleanupTable = exported.tables.find((table) => table.tableName === 'bcnRateLimitCleanup')
    if (metadata.models.rateLimit) {
      // The scheduler singleton is component-owned, never an adapter model. Validate
      // it exactly as well: extra tables or columns must still fail closed.
      if (
        !cleanupTable ||
        JSON.stringify(cleanupTable.documentType) !==
          JSON.stringify({
            type: 'object',
            value: { retentionWindow: { fieldType: { type: 'number' }, optional: false } },
          }) ||
        [
          cleanupTable.indexes,
          cleanupTable.searchIndexes,
          cleanupTable.stagedDbIndexes,
          cleanupTable.stagedSearchIndexes,
          cleanupTable.vectorIndexes,
          cleanupTable.stagedVectorIndexes,
        ].some((indexes) => indexes.length > 0)
      )
        mismatch()
    } else if (cleanupTable) mismatch()
    if (models.length + (metadata.models.rateLimit ? 1 : 0) !== exported.tables.length) mismatch()

    const tablesByName = new Map(exported.tables.map((table) => [table.tableName, table]))
    for (const model of models) {
      if (metadata.models[model.physicalName] !== model) mismatch()
      const table = tablesByName.get(model.physicalName)
      if (!table || table.documentType?.type !== 'object') mismatch()
      if (
        table.searchIndexes.length > 0 ||
        table.stagedDbIndexes.length > 0 ||
        table.stagedSearchIndexes.length > 0 ||
        table.vectorIndexes.length > 0 ||
        table.stagedVectorIndexes.length > 0
      ) {
        mismatch()
      }

      const fields = Object.values(model.fields)
      const legacyFields = Object.entries(model.legacyFields ?? {})
      const exportedFields = table.documentType.value
      if (fields.length + legacyFields.length !== Object.keys(exportedFields).length) mismatch()
      for (const [name, kind] of legacyFields) {
        const exportedField = exportedFields[name]
        if (
          Object.hasOwn(model.fields, name) ||
          !exportedField ||
          exportedField.optional !== true ||
          JSON.stringify(exportedField.fieldType) !== JSON.stringify(expectedBaseValidator(kind))
        ) {
          mismatch()
        }
      }
      for (const field of fields) {
        if (model.fields[field.physicalName] !== field) mismatch()
        const exportedField = exportedFields[field.physicalName]
        if (
          !exportedField ||
          exportedField.optional !== (field.optional === true) ||
          !validatorMatches(field, exportedField.fieldType)
        ) {
          mismatch()
        }
      }

      if (model.indexes.length !== table.indexes.length) mismatch()
      for (const index of model.indexes) {
        const exportedIndex = table.indexes.find(
          (candidate) => candidate.indexDescriptor === index.descriptor,
        )
        if (!exportedIndex || !sameStrings(index.fields, exportedIndex.fields)) mismatch()
      }
    }
  } catch {
    mismatch()
  }
}

export function getAuthModelMetadata(
  metadata: AuthSchemaMetadata,
  model: string,
): AuthModelMetadata {
  const result = metadata.models[model]
  if (!result) throw new Error(`AUTH_MODEL_UNKNOWN:${model}`)
  return result
}

export function getAuthFieldMetadata(
  metadata: AuthSchemaMetadata,
  model: string,
  field: string,
): AuthFieldMetadata {
  const result = getAuthModelMetadata(metadata, model).fields[field]
  if (!result) throw new Error(`AUTH_FIELD_UNKNOWN:${model}.${field}`)
  return result
}
