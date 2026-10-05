import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import { getFunctionName } from 'convex/server'
import { computed, onScopeDispose, shallowRef, type ComputedRef } from 'vue'

import {
  ConvexCallError,
  normalizeConvexError,
  type ConvexCallErrorCode,
  type ConvexFormError,
  type ConvexFormIssue,
} from './errors'
import {
  createSubmissionFormError,
  createValidationFormError,
  type ConvexFormErrorMapping,
} from './form-errors'
import type { CallableControllerObserver } from './internal/callable-controller'
import { isIdentityChangedError } from './internal/identity-changed-error'
import type { InternalOperation } from './internal/operation-controller'
import { snapshotArgs } from './internal/snapshot-args'
import type { ConvexCallStatus } from './use-callable'
import { useOperationController } from './use-operation'

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

/**
 * The state refs and verb returned by {@link useConvexForm}.
 *
 * `submit` resolves with `{ ok: false, error }` for validation and mutation
 * failures, so templates can await it without `try`. It rejects with a
 * {@link ConvexCallError} coded `SUBMIT_IN_PROGRESS` while an earlier
 * submission is pending, and with a `TypeError` when form and contextual
 * arguments overlap.
 */
export interface UseConvexFormReturn<
  Input extends FormRecord,
  ExtraArgs extends FormRecord,
  Result,
> {
  readonly submit: (
    values: Input,
    ...extraArgs: SubmitExtraParameters<ExtraArgs>
  ) => Promise<ConvexFormSubmitResult<Result>>
  /** The latest successful mutation result, or `undefined`. */
  readonly data: ComputedRef<Result | undefined>
  readonly status: ComputedRef<ConvexCallStatus>
  readonly pending: ComputedRef<boolean>
  /** The latest validation or submission failure, or `undefined`. */
  readonly error: ComputedRef<ConvexFormError | undefined>
  readonly issues: ComputedRef<readonly ConvexFormIssue[]>
  readonly fieldErrors: ComputedRef<Readonly<Record<string, readonly string[]>>>
  readonly formError: ComputedRef<string | undefined>
  /**
   * Returns to `idle`, clears `data` and `error`, and retires a pending
   * submission: it still settles its own promise but no longer updates state,
   * and a new submission may start at once. An identity change does the same.
   */
  readonly reset: () => void
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
> = FormOptionsBase<Schema, Input> &
  CompatibleProduced<Output, Args> & {
    readonly toArgs?: never
  }

type MappedFormOptions<
  Schema extends StandardSchemaV1,
  Input extends FormRecord,
  Output,
  Produced extends FormRecord,
  Args extends FormRecord,
> = FormOptionsBase<Schema, Input> & {
  readonly toArgs: (values: Output) => Produced & Record<Exclude<keyof Produced, keyof Args>, never>
}

/** Options accepted by the untyped adapter entry {@link useConvexFormInternal}. */
export type ConvexFormInternalOptions = FormOptionsBase<StandardSchemaV1, FormRecord> & {
  readonly toArgs?: (values: unknown) => FormRecord
}

function hasOverlappingKeys(left: FormRecord, right: FormRecord): boolean {
  return Object.keys(left).some((key) => Object.hasOwn(right, key))
}

/**
 * Validates form values with a Standard Schema and submits one Convex mutation.
 *
 * ```ts
 * const { submit, pending, fieldErrors, formError } = useConvexForm(api.notes.create, {
 *   schema: z.object({ title: z.string().min(1) }),
 * })
 * const result = await submit({ title })
 * ```
 *
 * Use `toArgs` to map validated values to mutation arguments. Pass the
 * remaining mutation arguments as the second `submit` argument. `mapError`
 * maps a {@link ConvexCallError} to field or form messages.
 */
export function useConvexForm<
  Mutation extends FunctionReference<'mutation'>,
  Schema extends StandardSchemaV1<FormRecord, FormRecord>,
>(
  mutation: Mutation,
  options: DirectFormOptions<
    Schema,
    StandardSchemaV1.InferInput<Schema>,
    StandardSchemaV1.InferOutput<Schema>,
    FunctionArgs<Mutation>
  >,
): UseConvexFormReturn<
  StandardSchemaV1.InferInput<Schema>,
  RemainingArgs<FunctionArgs<Mutation>, StandardSchemaV1.InferOutput<Schema>>,
  FunctionReturnType<Mutation>
>
/** Validates with `schema`, maps the output with `toArgs`, and submits one Convex mutation. */
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
    FunctionArgs<Mutation>
  >,
): UseConvexFormReturn<
  StandardSchemaV1.InferInput<Schema>,
  RemainingArgs<FunctionArgs<Mutation>, Produced>,
  FunctionReturnType<Mutation>
>
export function useConvexForm(
  mutation: FunctionReference<'mutation'>,
  options: ConvexFormInternalOptions,
): UseConvexFormReturn<FormRecord, FormRecord, unknown> {
  return useConvexFormInternal(mutation, options)
}

/** Adapter entry for {@link useConvexForm}; the same lifecycle plus a mutation observer. */
export function useConvexFormInternal(
  mutation: FunctionReference<'mutation'>,
  options: ConvexFormInternalOptions,
  observer?: CallableControllerObserver<FormRecord, unknown>,
): UseConvexFormReturn<FormRecord, FormRecord, unknown> {
  const operations = useOperationController('useConvexForm')
  const functionName = getFunctionName(mutation)

  // Shallow refs keep the exact mutation result and the returned form error.
  const data = shallowRef<unknown>()
  const currentStatus = shallowRef<ConvexCallStatus>('idle')
  const error = shallowRef<ConvexFormError>()
  let activePromise: Promise<ConvexFormSubmitResult<unknown>> | undefined
  let activeOperation: InternalOperation | undefined
  let revision = 0
  let disposed = false

  const status = computed(() => currentStatus.value)
  const pending = computed(() => currentStatus.value === 'pending')
  const issues = computed(() => error.value?.issues ?? [])
  const fieldErrors = computed(() => error.value?.fieldErrors ?? {})
  const formError = computed(() => error.value?.formError)

  const observe = (callback: () => void) => {
    if (!observer) return
    try {
      callback()
    } catch {
      // Diagnostics are non-authoritative and cannot replace the remote outcome.
    }
  }

  /** Send the mutation as a step of the submission's operation, observed for DevTools. */
  const dispatch = async (operation: InternalOperation, args: FormRecord): Promise<unknown> => {
    const startedAt = Date.now()
    let event: unknown
    observe(() => {
      event = observer!.startEvent(args, startedAt)
    })
    try {
      const result = await operation.mutation(mutation as never, args as never)
      observe(() => observer!.finishEvent(event, result, startedAt))
      return result
    } catch (rawError) {
      const failure = normalizeConvexError(rawError, { functionName })
      observe(() => observer!.failEvent(event, failure, startedAt))
      throw failure
    }
  }

  const submit = (
    values: FormRecord,
    ...extraArgs: [FormRecord?]
  ): Promise<ConvexFormSubmitResult<unknown>> => {
    if (activePromise) {
      return Promise.reject(
        new ConvexCallError({
          kind: 'unknown',
          code: 'SUBMIT_IN_PROGRESS' satisfies ConvexCallErrorCode,
          message: 'A submission is already in progress for this form',
          functionName,
          outcome: 'not-sent',
        }),
      )
    }
    const snapshot = snapshotArgs(values)
    const extra = snapshotArgs(extraArgs[0] ?? {})
    const knownFields = new Set(Object.keys(snapshot))
    const attempt = ++revision
    // The submission belongs to the identity that is current now, before
    // async validation: values captured under one identity never reach another.
    const operation = operations.begin()
    activeOperation = operation
    const owns = () => !disposed && revision === attempt

    const execute = async (): Promise<ConvexFormSubmitResult<unknown>> => {
      try {
        const validation = await options.schema['~standard'].validate(snapshot)
        const retirement = operation.retirement
        if (retirement) {
          throw new ConvexCallError({ ...retirement.toJSON(), functionName, outcome: 'not-sent' })
        }
        if (validation.issues) {
          const failure = createValidationFormError(validation.issues, knownFields)
          if (owns()) {
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

        const result = await dispatch(operation, { ...produced, ...extra })
        if (owns()) {
          data.value = result
          currentStatus.value = 'success'
        }
        return Object.freeze({ ok: true, data: result })
      } catch (rawError) {
        if (!(rawError instanceof ConvexCallError)) throw rawError
        const failure = createSubmissionFormError(rawError, knownFields, options.mapError)
        if (owns() && !isIdentityChangedError(rawError)) {
          error.value = failure
          currentStatus.value = 'error'
        }
        return Object.freeze({ ok: false, error: failure })
      }
    }

    // Defer validation so the guard is reserved before synchronous pending watchers run.
    const promise = Promise.resolve()
      .then(execute)
      .finally(() => {
        // reset() and disposal retire the submission and already own the state.
        if (activePromise !== promise) return
        activePromise = undefined
        activeOperation = undefined
        // A thrown TypeError or non-call failure leaves no committed outcome.
        if (currentStatus.value === 'pending') currentStatus.value = 'idle'
      })
    activePromise = promise
    data.value = undefined
    error.value = undefined
    currentStatus.value = 'pending'
    return promise
  }

  const reset = () => {
    revision += 1
    // A submission not yet sent is never sent; one in flight settles its own promise.
    activeOperation?.cancel()
    activeOperation = undefined
    activePromise = undefined
    data.value = undefined
    error.value = undefined
    currentStatus.value = 'idle'
  }

  // A settled result or mapped error belongs to the identity that produced it;
  // a new identity starts from a clean form, like the other callables.
  const stopIdentity = operations.onIdentityChange(reset)

  onScopeDispose(() => {
    disposed = true
    stopIdentity()
    reset()
  })

  return {
    submit,
    data: computed(() => data.value),
    status,
    pending,
    error: computed(() => error.value),
    issues,
    fieldErrors,
    formError,
    reset,
  } as UseConvexFormReturn<FormRecord, FormRecord, unknown>
}
