import { mergedStream, stream } from 'convex-helpers/server/stream'
import { validate } from 'convex-helpers/validators'
/*
 * Adapted from get-convex/better-auth at
 * c628916b451a6b4cff0f5464f134475464b1a6da (Apache-2.0).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- runtime model and index names come from generated metadata */
import type {
  GenericQueryCtx,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
} from 'convex/server'
import { v, type Infer } from 'convex/values'

import type { AuthIndexMetadata, AuthModelMetadata, AuthSchemaMetadata } from './metadata'
import { getAuthFieldMetadata, getAuthModelMetadata } from './metadata'

// Dates and JSON use the adapter's existing number and serialized-string wire forms.
export const authValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
  v.array(v.number()),
  v.null(),
)
export const authDocumentValidator = v.record(v.string(), authValueValidator)
export type AuthDocument = Infer<typeof authDocumentValidator>

export type AuthWhereOperator =
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'eq'
  | 'in'
  | 'not_in'
  | 'ne'
  | 'contains'
  | 'starts_with'
  | 'ends_with'

export interface AuthWhere {
  field: string
  operator?: AuthWhereOperator
  value: string | number | boolean | readonly string[] | readonly number[] | null
  connector?: 'AND' | 'OR'
  mode?: 'sensitive' | 'insensitive'
}

export interface AuthReadArgs {
  model: string
  where?: readonly AuthWhere[]
  select?: readonly string[]
  sortBy?: { field: string; direction: 'asc' | 'desc' }
  offset?: number
}

function compareNullable(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : 1
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === false ? -1 : 1
  return String(left).localeCompare(String(right))
}

export function matchesAuthWhere(
  doc: Record<string, unknown>,
  where: readonly AuthWhere[] = [],
): boolean {
  if (where.length === 0) return true

  const evaluate = (clause: AuthWhere): boolean => {
    const actual = doc[clause.field]
    const expected = clause.value
    const insensitive = clause.mode === 'insensitive'
    const normalize = (value: unknown) =>
      insensitive && typeof value === 'string' ? value.toLocaleLowerCase() : value
    const normalizedActual = normalize(actual)
    const normalizedExpected = Array.isArray(expected)
      ? expected.map((value) => normalize(value))
      : normalize(expected)
    switch (clause.operator ?? 'eq') {
      case 'eq':
        return expected === null
          ? actual === null || actual === undefined
          : normalizedActual === normalizedExpected
      case 'ne':
        return normalizedActual !== normalizedExpected
      case 'lt':
        return expected !== null && compareNullable(actual, expected) < 0
      case 'lte':
        return expected !== null && compareNullable(actual, expected) <= 0
      case 'gt':
        return expected !== null && compareNullable(actual, expected) > 0
      case 'gte':
        return expected !== null && compareNullable(actual, expected) >= 0
      case 'in':
        return (
          Array.isArray(normalizedExpected) &&
          normalizedExpected.includes(normalizedActual as never)
        )
      case 'not_in':
        return (
          Array.isArray(normalizedExpected) &&
          !normalizedExpected.includes(normalizedActual as never)
        )
      case 'contains':
        return (
          typeof normalizedActual === 'string' &&
          typeof normalizedExpected === 'string' &&
          normalizedActual.includes(normalizedExpected)
        )
      case 'starts_with':
        return (
          typeof normalizedActual === 'string' &&
          typeof normalizedExpected === 'string' &&
          normalizedActual.startsWith(normalizedExpected)
        )
      case 'ends_with':
        return (
          typeof normalizedActual === 'string' &&
          typeof normalizedExpected === 'string' &&
          normalizedActual.endsWith(normalizedExpected)
        )
    }
  }

  let result = evaluate(where[0]!)
  for (const clause of where.slice(1)) {
    const clauseResult = evaluate(clause)
    result = clause.connector === 'OR' ? result || clauseResult : result && clauseResult
  }
  return result
}

export function validateAuthReadArgs(metadata: AuthSchemaMetadata, args: AuthReadArgs): void {
  const model = getAuthModelMetadata(metadata, args.model)
  if (args.offset !== undefined && args.offset !== 0) throw new Error('AUTH_OFFSET_UNSUPPORTED')
  for (const clause of args.where ?? []) {
    const field = getAuthFieldMetadata(metadata, args.model, clause.field)
    if (
      clause.mode === 'insensitive' &&
      typeof clause.value !== 'string' &&
      !(Array.isArray(clause.value) && clause.value.every((value) => typeof value === 'string'))
    ) {
      throw new Error(`AUTH_CASE_INSENSITIVE_VALUE_INVALID:${args.model}.${field.physicalName}`)
    }
    if (
      (clause.operator === 'in' || clause.operator === 'not_in') &&
      !Array.isArray(clause.value)
    ) {
      throw new Error(`AUTH_ARRAY_OPERATOR_REQUIRES_ARRAY:${args.model}.${field.physicalName}`)
    }
  }
  for (const fieldName of args.select ?? []) getAuthFieldMetadata(metadata, args.model, fieldName)
  if (args.sortBy) {
    const field = getAuthFieldMetadata(metadata, args.model, args.sortBy.field)
    if (!field.sortable && field.physicalName !== 'createdAt') {
      throw new Error(`AUTH_FIELD_NOT_SORTABLE:${model.physicalName}.${field.physicalName}`)
    }
  }
}

interface IndexPlan {
  index: AuthIndexMetadata
  equality: readonly AuthWhere[]
  range?: AuthWhere
  score: number
}

const AUTH_IN_FANOUT_LIMIT = 64

interface ExactIndexedIn {
  clause: AuthWhere & { value: readonly (string | number)[] }
  index: AuthIndexMetadata
}

function chooseExactIndexedIn(
  model: AuthModelMetadata,
  where: readonly AuthWhere[],
  sortBy: AuthReadArgs['sortBy'],
): ExactIndexedIn | undefined {
  if (
    sortBy ||
    where.some((clause) => clause.connector === 'OR' || clause.mode === 'insensitive')
  ) {
    return undefined
  }
  const clauses = where.filter((clause) => clause.operator === 'in')
  if (clauses.length !== 1) return undefined
  const clause = clauses[0]!
  if (!Array.isArray(clause.value)) return undefined
  const index = model.indexes.find(
    (candidate) => candidate.fields.length === 1 && candidate.fields[0] === clause.field,
  )
  if (!index) return undefined
  if (clause.value.length > AUTH_IN_FANOUT_LIMIT) {
    throw new Error('AUTH_IN_FANOUT_LIMIT_EXCEEDED')
  }
  return {
    clause: clause as ExactIndexedIn['clause'],
    index,
  }
}

function planForIndex(
  index: AuthIndexMetadata,
  where: readonly AuthWhere[],
): IndexPlan | undefined {
  const equality: AuthWhere[] = []
  let range: AuthWhere | undefined
  let prefix = 0
  for (const field of index.fields) {
    const eq = where.find(
      (clause) =>
        clause.field === field && (clause.operator === undefined || clause.operator === 'eq'),
    )
    if (eq) {
      equality.push(eq)
      prefix += 1
      continue
    }
    range = where.find(
      (clause) =>
        clause.field === field &&
        (clause.operator === 'lt' ||
          clause.operator === 'lte' ||
          clause.operator === 'gt' ||
          clause.operator === 'gte'),
    )
    if (range) prefix += 1
    break
  }
  if (prefix === 0) return undefined
  return { index, equality, range, score: prefix * 10 + equality.length }
}

function chooseIndex(model: AuthModelMetadata, where: readonly AuthWhere[]): IndexPlan | undefined {
  if (where.some((clause) => clause.connector === 'OR' || clause.mode === 'insensitive')) {
    return undefined
  }
  return model.indexes
    .map((index) => planForIndex(index, where))
    .filter((plan): plan is IndexPlan => plan !== undefined)
    .sort((left, right) => right.score - left.score)[0]
}

function planForSortIndex(
  index: AuthIndexMetadata,
  where: readonly AuthWhere[],
  sortField: string,
): IndexPlan | undefined {
  if (index.fields.at(-1) !== sortField) return undefined

  const equality: AuthWhere[] = []
  for (const field of index.fields.slice(0, -1)) {
    const clause = where.find(
      (candidate) =>
        candidate.field === field &&
        (candidate.operator === undefined || candidate.operator === 'eq'),
    )
    if (!clause) return undefined
    equality.push(clause)
  }

  const range = where.find(
    (clause) =>
      clause.field === sortField &&
      (clause.operator === 'lt' ||
        clause.operator === 'lte' ||
        clause.operator === 'gt' ||
        clause.operator === 'gte'),
  )
  return {
    index,
    equality,
    range,
    score: index.fields.length * 10 + equality.length,
  }
}

function chooseSortIndex(
  model: AuthModelMetadata,
  where: readonly AuthWhere[],
  sortField: string,
): IndexPlan | undefined {
  const filterOnly = where.some(
    (clause) => clause.connector === 'OR' || clause.mode === 'insensitive',
  )
  return (
    model.indexes
      // A single-field sort index is still exact when OR/case-insensitive
      // predicates must be evaluated by filterWith. Compound prefix constraints
      // are unsafe in that case because they could exclude an OR branch.
      .filter((index) => !filterOnly || index.fields.length === 1)
      .map((index) => planForSortIndex(index, filterOnly ? [] : where, sortField))
      .filter((plan): plan is IndexPlan => plan !== undefined)
      .sort((left, right) => right.score - left.score)[0]
  )
}

function applyIndexRange(builder: any, plan: IndexPlan): any {
  let result = builder
  for (const clause of plan.equality) result = result.eq(clause.field, clause.value)
  if (!plan.range) return result
  switch (plan.range.operator) {
    case 'lt':
      return result.lt(plan.range.field, plan.range.value)
    case 'lte':
      return result.lte(plan.range.field, plan.range.value)
    case 'gt':
      return result.gt(plan.range.field, plan.range.value)
    case 'gte':
      return result.gte(plan.range.field, plan.range.value)
    default:
      return result
  }
}

function createAuthQuery(
  ctx: GenericQueryCtx<any>,
  schema: SchemaDefinition<any, any>,
  metadata: AuthSchemaMetadata,
  args: AuthReadArgs,
) {
  validateAuthReadArgs(metadata, args)
  const model = getAuthModelMetadata(metadata, args.model)
  const exactIndexedIn = chooseExactIndexedIn(model, args.where ?? [], args.sortBy)
  if (exactIndexedIn && exactIndexedIn.clause.value.length > 0) {
    const values = [...new Set(exactIndexedIn.clause.value)]
    const streams = values.map((value) =>
      stream(ctx.db as any, schema)
        .query(args.model as never)
        .withIndex(exactIndexedIn.index.descriptor as never, (builder: any) =>
          builder.eq(exactIndexedIn.clause.field, value),
        ),
    )
    // Equality removes the selected field from each stream's effective order,
    // so merging on creation time preserves the adapter's default pagination order.
    return mergedStream(streams, ['_creationTime']).filterWith(
      async (doc: Record<string, unknown>) => matchesAuthWhere(doc, args.where ?? []),
    )
  }
  const plan = chooseIndex(model, args.where ?? [])
  let query: any = stream(ctx.db as any, schema).query(args.model as never)
  if (plan) {
    query = query.withIndex(plan.index.descriptor as never, (builder: any) =>
      applyIndexRange(builder, plan),
    )
  }
  if (args.sortBy) {
    const sortPlan = chooseSortIndex(model, args.where ?? [], args.sortBy.field)
    if (!sortPlan) {
      throw new Error(`AUTH_SORT_INDEX_MISSING:${args.model}.${args.sortBy.field}`)
    }
    query = stream(ctx.db as any, schema)
      .query(args.model as never)
      .withIndex(sortPlan.index.descriptor as never, (builder: any) =>
        applyIndexRange(builder, sortPlan),
      )
      .order(args.sortBy.direction)
  }
  return query.filterWith(async (doc: Record<string, unknown>) =>
    matchesAuthWhere(doc, args.where ?? []),
  )
}

export function toBetterAuthDocument(
  doc: Record<string, unknown>,
  select?: readonly string[],
): AuthDocument
export function toBetterAuthDocument(
  doc: Record<string, unknown> | null,
  select?: readonly string[],
): AuthDocument | null
export function toBetterAuthDocument(
  doc: Record<string, unknown> | null,
  select?: readonly string[],
): AuthDocument | null {
  if (!doc) return null
  const clean: Record<string, unknown> = Object.fromEntries(
    Object.entries(doc).filter(([field]) => field !== '_id' && field !== '_creationTime'),
  )
  if (Object.values(clean).includes(undefined) || !validate(authDocumentValidator, clean)) {
    throw new Error('AUTH_DOCUMENT_INVALID')
  }
  if (!select?.length) return clean
  const selected: AuthDocument = {}
  for (const field of select) {
    const value = clean[field]
    if (value !== undefined) selected[field] = value
  }
  return selected
}

export async function paginateAuthRows(
  ctx: GenericQueryCtx<any>,
  schema: SchemaDefinition<any, any>,
  metadata: AuthSchemaMetadata,
  args: AuthReadArgs,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<AuthDocument>> {
  const result = await createAuthQuery(ctx, schema, metadata, args).paginate({
    ...paginationOpts,
    maximumRowsRead: Math.max((paginationOpts.numItems ?? 0) + 1, 200),
  })
  return {
    ...result,
    page: result.page.map((doc: Record<string, unknown>) => toBetterAuthDocument(doc, args.select)),
  }
}

export async function collectAuthRows(
  ctx: GenericQueryCtx<any>,
  schema: SchemaDefinition<any, any>,
  metadata: AuthSchemaMetadata,
  args: AuthReadArgs,
  maximum?: number,
): Promise<Record<string, unknown>[]> {
  if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 0)) {
    throw new TypeError('AUTH_QUERY_LIMIT_INVALID')
  }
  const rows: Record<string, unknown>[] = []
  let cursor: string | null = null
  do {
    const requested = maximum === undefined ? 100 : Math.min(100, maximum + 1 - rows.length)
    const page: any = await createAuthQuery(ctx, schema, metadata, args).paginate({
      cursor,
      numItems: requested,
      maximumRowsRead: 200,
    })
    rows.push(...page.page)
    if (maximum !== undefined && rows.length > maximum) {
      throw new Error(`AUTH_QUERY_LIMIT_EXCEEDED:${maximum}`)
    }
    if (page.isDone) {
      cursor = null
      continue
    }
    if (typeof page.continueCursor !== 'string' || page.continueCursor === cursor) {
      throw new Error('AUTH_QUERY_PAGINATION_STALLED')
    }
    cursor = page.continueCursor
  } while (cursor !== null)
  return rows
}

/**
 * Count the complete result set in one component query with bounded page
 * memory. It has no product-defined row ceiling and uses the same selector as
 * fully paginated `findMany` and atomic bulk mutations.
 */
export async function countAuthRows(
  ctx: GenericQueryCtx<any>,
  schema: SchemaDefinition<any, any>,
  metadata: AuthSchemaMetadata,
  args: AuthReadArgs,
): Promise<number> {
  let count = 0
  let cursor: string | null = null
  while (true) {
    const cursorBefore: string | null = cursor
    const page: any = await createAuthQuery(ctx, schema, metadata, args).paginate({
      cursor,
      numItems: 100,
      maximumRowsRead: 200,
    })
    count += page.page.length
    if (page.isDone) return count
    if (typeof page.continueCursor !== 'string') {
      throw new TypeError('AUTH_COUNT_PAGINATION_INVALID')
    }
    cursor = page.continueCursor
    if (cursor === cursorBefore && page.page.length === 0) {
      throw new Error('AUTH_COUNT_PAGINATION_STALLED')
    }
  }
}

export async function findAuthRows(
  ctx: GenericQueryCtx<any>,
  schema: SchemaDefinition<any, any>,
  metadata: AuthSchemaMetadata,
  args: AuthReadArgs,
  maximum = 2,
): Promise<Record<string, unknown>[]> {
  const rows = await collectAuthRows(ctx, schema, metadata, args, maximum)
  return rows
}
