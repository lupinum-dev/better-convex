import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { ConvexCallError } from './errors'

type StringKey<Value> = Extract<keyof Value, string>

export interface ConvexFormIssue {
  readonly message: string
  readonly path: readonly PropertyKey[]
  readonly field?: string
}

export type ConvexFormErrorKind = 'validation' | 'submission'

export interface ConvexFormErrorMapping<Input extends object> {
  readonly form?: string
  readonly fields?: Readonly<Partial<Record<StringKey<Input>, string | readonly string[]>>>
}

type ConvexFormErrorInput = Readonly<{
  kind: ConvexFormErrorKind
  message: string
  issues?: readonly ConvexFormIssue[]
  fieldErrors?: Readonly<Record<string, readonly string[]>>
  formError?: string
  callError?: ConvexCallError
}>

/** A safe form-facing failure. Raw validator and mapper causes are never retained. */
export class ConvexFormError extends Error {
  readonly kind: ConvexFormErrorKind
  readonly issues: readonly ConvexFormIssue[]
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>
  readonly formError?: string
  readonly callError?: ConvexCallError

  constructor(input: ConvexFormErrorInput) {
    super(input.message)
    this.name = 'ConvexFormError'
    this.kind = input.kind
    this.issues = Object.freeze([...(input.issues ?? [])])
    this.fieldErrors = Object.freeze({ ...(input.fieldErrors ?? {}) })
    this.formError = input.formError
    this.callError = input.callError
  }

  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      issues: this.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === 'symbol' ? (segment.description ?? 'symbol') : segment,
        ),
        field: issue.field,
      })),
      fieldErrors: this.fieldErrors,
      formError: this.formError,
      callError: this.callError?.toJSON(),
    }
  }
}

function normalizeIssuePath(path: StandardSchemaV1.Issue['path']): readonly PropertyKey[] {
  if (!path) return []
  return path.map((segment) =>
    typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment,
  )
}

export function createValidationFormError(
  rawIssues: readonly StandardSchemaV1.Issue[],
  knownFields: ReadonlySet<string>,
): ConvexFormError {
  const fieldErrors: Record<string, string[]> = {}
  const formMessages: string[] = []
  const issues = rawIssues.map((rawIssue): ConvexFormIssue => {
    const path = normalizeIssuePath(rawIssue.path)
    const first = path[0]
    const field = typeof first === 'string' && knownFields.has(first) ? first : undefined
    if (field) (fieldErrors[field] ??= []).push(rawIssue.message)
    else formMessages.push(rawIssue.message)
    return Object.freeze({ message: rawIssue.message, path: Object.freeze([...path]), field })
  })
  const formError = formMessages[0]
  return new ConvexFormError({
    kind: 'validation',
    message: formError ?? issues[0]?.message ?? 'Form validation failed',
    issues,
    fieldErrors,
    formError,
  })
}

function normalizeMappedFields(
  fields: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  knownFields: ReadonlySet<string>,
): { fieldErrors: Record<string, readonly string[]>; unknownMessages: string[] } {
  const fieldErrors: Record<string, readonly string[]> = {}
  const unknownMessages: string[] = []
  for (const [field, value] of Object.entries(fields ?? {})) {
    if (value === undefined) continue
    const messages = (typeof value === 'string' ? [value] : [...value]).filter(Boolean)
    if (messages.length === 0) continue
    if (knownFields.has(field)) fieldErrors[field] = Object.freeze(messages)
    else unknownMessages.push(...messages)
  }
  return { fieldErrors, unknownMessages }
}

export function createSubmissionFormError<Input extends object>(
  callError: ConvexCallError,
  knownFields: ReadonlySet<string>,
  mapError?: (error: ConvexCallError) => ConvexFormErrorMapping<Input> | undefined,
): ConvexFormError {
  let mapping: ConvexFormErrorMapping<Input> | undefined
  try {
    mapping = mapError?.(callError)
  } catch {
    mapping = undefined
  }
  const { fieldErrors, unknownMessages } = normalizeMappedFields(mapping?.fields, knownFields)
  const mappedFormMessages = [mapping?.form, ...unknownMessages].filter(
    (message): message is string => Boolean(message),
  )
  const formError =
    mappedFormMessages.length > 0
      ? mappedFormMessages.join(' ')
      : mapping
        ? undefined
        : callError.message
  const firstFieldMessage = Object.values(fieldErrors)[0]?.[0]
  return new ConvexFormError({
    kind: 'submission',
    message: formError ?? firstFieldMessage ?? callError.message,
    fieldErrors,
    formError,
    callError,
  })
}
