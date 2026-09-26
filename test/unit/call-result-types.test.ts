import type { FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ComputedRef } from 'vue'

import type {
  ConvexCallStatus,
  UseConvexActionReturn,
  UseConvexMutationReturn,
} from '../../packages/vue/src'
import {
  isConvexCallError,
  normalizeConvexError,
  type ConvexCallError,
  type ConvexCallErrorCode,
} from '../../src/runtime/errors'

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false

type ConvexArgs = Record<string, unknown>
type MutationRef<Args extends ConvexArgs, Result> = FunctionReference<
  'mutation',
  'public',
  Args,
  Result
>
type ActionRef<Args extends ConvexArgs, Result> = FunctionReference<
  'action',
  'public',
  Args,
  Result
>
type Argless = Record<string, never>

type MutationReturn = UseConvexMutationReturn<MutationRef<{ id: string }, { id: string }>>
type ActionReturn = UseConvexActionReturn<ActionRef<{ id: string }, { id: string }>>

type _MutationKeys = Assert<
  IsEqual<keyof MutationReturn, 'mutate' | 'data' | 'status' | 'pending' | 'error' | 'reset'>
>
type _MutationResult = Assert<
  IsEqual<Awaited<ReturnType<MutationReturn['mutate']>>, { id: string }>
>
type _MutationArgs = Assert<IsEqual<Parameters<MutationReturn['mutate']>, [args: { id: string }]>>
type _ArglessMutationArgs = Assert<
  IsEqual<
    Parameters<UseConvexMutationReturn<MutationRef<Argless, string>>['mutate']>,
    [args?: Argless]
  >
>
type _MutationIsNotCallable = Assert<
  IsEqual<MutationReturn extends (...args: never[]) => unknown ? true : false, false>
>
type _MutationHasNoRun = Assert<IsEqual<HasKey<MutationReturn, 'run'>, false>>
type _MutationHasNoSafe = Assert<IsEqual<HasKey<MutationReturn, 'safe'>, false>>
type _MutationReset = Assert<IsEqual<MutationReturn['reset'], () => void>>

type _ActionKeys = Assert<
  IsEqual<keyof ActionReturn, 'run' | 'data' | 'status' | 'pending' | 'error' | 'reset'>
>
type _ActionResult = Assert<IsEqual<Awaited<ReturnType<ActionReturn['run']>>, { id: string }>>
type _ActionArgs = Assert<IsEqual<Parameters<ActionReturn['run']>, [args: { id: string }]>>
type _ArglessActionArgs = Assert<
  IsEqual<Parameters<UseConvexActionReturn<ActionRef<Argless, string>>['run']>, [args?: Argless]>
>
type _ActionHasNoMutate = Assert<IsEqual<HasKey<ActionReturn, 'mutate'>, false>>
type _ActionHasNoSafe = Assert<IsEqual<HasKey<ActionReturn, 'safe'>, false>>

function stateContract(mutation: MutationReturn, action: ActionReturn) {
  const { data, error, status, pending } = mutation
  expectTypeOf(data).toEqualTypeOf<ComputedRef<{ id: string } | undefined>>()
  expectTypeOf(error).toEqualTypeOf<ComputedRef<ConvexCallError | undefined>>()
  expectTypeOf(status).toEqualTypeOf<ComputedRef<ConvexCallStatus>>()
  expectTypeOf(pending).toEqualTypeOf<ComputedRef<boolean>>()
  expectTypeOf(action.data).toEqualTypeOf<ComputedRef<{ id: string } | undefined>>()
  // @ts-expect-error callable state is readonly
  data.value = { id: 'written' }
  // @ts-expect-error callable state is readonly
  action.error.value = undefined
}

function errorContract(error: unknown) {
  if (isConvexCallError(error, 'IDENTITY_CHANGED')) {
    expectTypeOf(error).toEqualTypeOf<ConvexCallError>()
  }
  // Application codes stay plain strings.
  void isConvexCallError(error, 'NOTE_EXISTS')
  expectTypeOf<'CANCELLED'>().toExtend<ConvexCallErrorCode>()
  // @ts-expect-error application codes are not library codes
  const applicationCode: ConvexCallErrorCode = 'NOTE_EXISTS'
  void applicationCode
  expectTypeOf(normalizeConvexError)
    .parameter(1)
    .toEqualTypeOf<{ readonly functionName?: string } | undefined>()
}

describe('callable and error type contracts', () => {
  it('keeps one destructurable object contract per callable kind', () => {
    expect(stateContract).toBeTypeOf('function')
    expect(errorContract).toBeTypeOf('function')
  })

  it('does not special-case a LIMIT_* message prefix into a code', () => {
    // The normalizer never classifies from message text. A plain Error that
    // happens to start with LIMIT_ stays opaque `unknown`, and no code is
    // synthesized from it.
    const normalized = normalizeConvexError(new Error('LIMIT_ITEMS: Limit reached'))
    expect(normalized.kind).toBe('unknown')
    expect(normalized.message).toBe('Unknown Convex error')
    expect(normalized.code).toBeUndefined()
  })

  it('derives code and message from a Convex application error, preserving its data', () => {
    // Structured extraction requires the pinned ConvexError contract: a plain
    // Error carrying a `.data` bag is NOT a Convex application error and stays
    // `unknown`. A real ConvexError becomes `server` with its `data.code` and
    // developer-authored `data.message` surfaced and its data preserved.
    const plain = new Error('fallback message') as Error & {
      data?: { message: string; code: string }
    }
    plain.data = { message: 'Limit reached', code: 'LIMIT_ITEMS' }
    const plainNormalized = normalizeConvexError(plain)
    expect(plainNormalized.kind).toBe('unknown')
    expect(plainNormalized.message).toBe('Unknown Convex error')
    expect(plainNormalized.code).toBeUndefined()

    const structured = normalizeConvexError(
      new ConvexError({ message: 'Limit reached', code: 'LIMIT_ITEMS' }),
    )
    expect(structured.kind).toBe('server')
    expect(structured.message).toBe('Limit reached')
    expect(structured.code).toBe('LIMIT_ITEMS')
    expect(structured.data).toEqual({ message: 'Limit reached', code: 'LIMIT_ITEMS' })
  })
})
