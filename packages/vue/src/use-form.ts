import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue'

import { ConvexCallError } from './errors'
import {
  createSubmissionFormError,
  createValidationFormError,
  type ConvexFormError,
  type ConvexFormErrorMapping,
  type ConvexFormIssue,
} from './form-errors'
import type { ConvexCallStatus } from './use-callable'
import { useConvexMutation } from './use-callable'

const CALLABLE_OBSERVER_KEY = Symbol.for('better-convex.callable-observer')

type FormRecord = Record<string, unknown>
type RequiredKeys<Value> = {
  [Key in keyof Value]-?: object extends Pick<Value, Key> ? never : Key
}[keyof Value]
type SubmitExtraParameters<ExtraArgs extends FormRecord> = keyof ExtraArgs extends never
  ? []
  : RequiredKeys<ExtraArgs> extends never
    ? [extraArgs?: ExtraArgs]
    : [extraArgs: ExtraArgs]
type RemainingArgs<Args extends FormRecord, Produced extends FormRecord> = Omit<
  Args,
  keyof Produced
>
type CompatibleProduced<Produced extends FormRecord, Args extends FormRecord> =
  Exclude<keyof Produced, keyof Args> extends never
    ? Produced extends Pick<Args, Extract<keyof Produced, keyof Args>>
      ? unknown
      : never
    : never

export type ConvexFormSubmitResult<Result> =
  | Readonly<{ ok: true; data: Result }>
  | Readonly<{ ok: false; error: ConvexFormError }>

export interface UseConvexFormReturn<
  Input extends FormRecord,
  ExtraArgs extends FormRecord,
  Result,
> {
  submit(
    values: Input,
    ...extraArgs: SubmitExtraParameters<ExtraArgs>
  ): Promise<ConvexFormSubmitResult<Result>>
  readonly data: Readonly<Ref<Result | undefined>>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  readonly error: Readonly<Ref<ConvexFormError | undefined>>
  readonly issues: ComputedRef<readonly ConvexFormIssue[]>
  readonly fieldErrors: ComputedRef<Readonly<Record<string, readonly string[]>>>
  readonly formError: ComputedRef<string | undefined>
  reset(): void
}

interface FormObserver<Args, Result> {
  startEvent(args: Args, startedAt: number): unknown
  finishEvent(event: unknown, result: Result, startedAt: number): void
  failEvent(event: unknown, error: ConvexCallError, startedAt: number): void
}

interface InternalFormOptions<Args, Result> {
  [CALLABLE_OBSERVER_KEY]?: FormObserver<Args, Result>
}

interface FormOptionsBase<Schema extends StandardSchemaV1, Input extends FormRecord> {
  readonly schema: Schema
  readonly mapError?: (error: ConvexCallError) => ConvexFormErrorMapping<Input> | undefined
}

type DirectFormOptions<
  Schema extends StandardSchemaV1,
  Input extends FormRecord,
  Output extends FormRecord,
  Args extends FormRecord,
  Result,
> = FormOptionsBase<Schema, Input> &
  InternalFormOptions<Args, Result> &
  CompatibleProduced<Output, Args> & {
    readonly toArgs?: never
  }

type MappedFormOptions<
  Schema extends StandardSchemaV1,
  Input extends FormRecord,
  Output,
  Produced extends FormRecord,
  Args extends FormRecord,
  Result,
> = FormOptionsBase<Schema, Input> &
  InternalFormOptions<Args, Result> & {
    readonly toArgs: (
      values: Output,
    ) => Produced & Record<Exclude<keyof Produced, keyof Args>, never>
  }

type AnyFormOptions = FormOptionsBase<StandardSchemaV1, FormRecord> &
  InternalFormOptions<FormRecord, unknown> & {
    readonly toArgs?: (values: unknown) => FormRecord
  }

function cloneSnapshot<Value>(value: Value): Value {
  const seen = new WeakMap<object, unknown>()
  const clone = (entry: unknown): unknown => {
    if (!entry || typeof entry !== 'object') return entry
    const prior = seen.get(entry)
    if (prior) return prior
    if (Array.isArray(entry)) {
      const next: unknown[] = []
      seen.set(entry, next)
      for (const item of entry) next.push(clone(item))
      return next
    }
    const prototype = Object.getPrototypeOf(entry)
    if (prototype !== Object.prototype && prototype !== null) return entry
    const next: Record<string, unknown> = {}
    seen.set(entry, next)
    for (const [key, item] of Object.entries(entry)) next[key] = clone(item)
    return next
  }
  return clone(value) as Value
}

function hasOverlappingKeys(left: FormRecord, right: FormRecord): boolean {
  return Object.keys(left).some((key) => Object.hasOwn(right, key))
}

export function useConvexForm<
  Mutation extends FunctionReference<'mutation'>,
  Schema extends StandardSchemaV1<FormRecord, FormRecord>,
>(
  mutation: Mutation,
  options: DirectFormOptions<
    Schema,
    StandardSchemaV1.InferInput<Schema>,
    StandardSchemaV1.InferOutput<Schema>,
    FunctionArgs<Mutation>,
    FunctionReturnType<Mutation>
  >,
): UseConvexFormReturn<
  StandardSchemaV1.InferInput<Schema>,
  RemainingArgs<FunctionArgs<Mutation>, StandardSchemaV1.InferOutput<Schema>>,
  FunctionReturnType<Mutation>
>
export function useConvexForm<
  Mutation extends FunctionReference<'mutation'>,
  Schema extends StandardSchemaV1<FormRecord, unknown>,
  Produced extends Partial<FunctionArgs<Mutation>> & FormRecord,
>(
  mutation: Mutation,
  options: MappedFormOptions<
    Schema,
    StandardSchemaV1.InferInput<Schema>,
    StandardSchemaV1.InferOutput<Schema>,
    Produced,
    FunctionArgs<Mutation>,
    FunctionReturnType<Mutation>
  >,
): UseConvexFormReturn<
  StandardSchemaV1.InferInput<Schema>,
  RemainingArgs<FunctionArgs<Mutation>, Produced>,
  FunctionReturnType<Mutation>
>
export function useConvexForm(
  mutation: FunctionReference<'mutation'>,
  options: AnyFormOptions,
): UseConvexFormReturn<FormRecord, FormRecord, unknown> {
  if (!getCurrentScope()) {
    throw new Error('[better-convex-vue] useConvexForm must run inside a Vue effect scope')
  }
  const internalMutationOptions = options[CALLABLE_OBSERVER_KEY]
    ? { [CALLABLE_OBSERVER_KEY]: options[CALLABLE_OBSERVER_KEY] }
    : undefined
  const mutate = (
    useConvexMutation as unknown as (
      reference: FunctionReference<'mutation'>,
      internalOptions?: Record<PropertyKey, unknown>,
    ) => (args: FormRecord) => Promise<unknown>
  )(mutation, internalMutationOptions)

  const data = ref<unknown>()
  const currentStatus = ref<ConvexCallStatus>('idle')
  const error = ref<ConvexFormError>()
  let activePromise: Promise<ConvexFormSubmitResult<unknown>> | undefined
  let revision = 0
  let disposed = false

  const status = computed(() => currentStatus.value)
  const pending = computed(() => activePromise !== undefined)
  const issues = computed(() => error.value?.issues ?? [])
  const fieldErrors = computed(() => error.value?.fieldErrors ?? {})
  const formError = computed(() => error.value?.formError)

  const submit = (
    values: FormRecord,
    ...extraArgs: [FormRecord?]
  ): Promise<ConvexFormSubmitResult<unknown>> => {
    if (activePromise) return activePromise
    const snapshot = cloneSnapshot(values)
    const extra = cloneSnapshot(extraArgs[0] ?? {})
    const knownFields = new Set(Object.keys(snapshot))
    const attempt = ++revision
    currentStatus.value = 'pending'
    data.value = undefined
    error.value = undefined

    const execute = async (): Promise<ConvexFormSubmitResult<unknown>> => {
      const validation = await options.schema['~standard'].validate(snapshot)
      if (validation.issues) {
        const failure = createValidationFormError(validation.issues, knownFields)
        if (!disposed && revision === attempt) {
          error.value = failure
          currentStatus.value = 'error'
        }
        return Object.freeze({ ok: false, error: failure })
      }

      const produced = options.toArgs
        ? options.toArgs(validation.value)
        : (validation.value as FormRecord)
      if (hasOverlappingKeys(produced, extra)) {
        throw new TypeError('[better-convex-vue] form and contextual mutation arguments overlap')
      }

      try {
        const result = await mutate({ ...produced, ...extra })
        if (!disposed && revision === attempt) {
          data.value = result
          currentStatus.value = 'success'
        }
        return Object.freeze({ ok: true, data: result })
      } catch (rawError) {
        if (!(rawError instanceof ConvexCallError)) throw rawError
        const failure = createSubmissionFormError(rawError, knownFields, options.mapError)
        const retiredIdentity = rawError.code === 'IDENTITY_CHANGED'
        if (!disposed && revision === attempt && !retiredIdentity) {
          error.value = failure
          currentStatus.value = 'error'
        }
        return Object.freeze({ ok: false, error: failure })
      }
    }

    const promise = execute().finally(() => {
      if (activePromise !== promise) return
      activePromise = undefined
      if (!disposed && (revision !== attempt || currentStatus.value === 'pending')) {
        currentStatus.value = 'idle'
      }
    })
    activePromise = promise
    return promise
  }

  const reset = () => {
    revision += 1
    data.value = undefined
    error.value = undefined
    currentStatus.value = activePromise ? 'pending' : 'idle'
  }

  onScopeDispose(() => {
    disposed = true
    revision += 1
    data.value = undefined
    error.value = undefined
    currentStatus.value = 'idle'
  })

  return Object.freeze({
    submit,
    data: readonly(data),
    status,
    pending,
    error: readonly(error),
    issues,
    fieldErrors,
    formError,
    reset,
  }) as UseConvexFormReturn<FormRecord, FormRecord, unknown>
}
