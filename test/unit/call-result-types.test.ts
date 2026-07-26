import type { FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'

import type { UseConvexActionReturn } from '../../src/runtime/composables/useConvexAction'
import type { UseConvexMutationReturn } from '../../src/runtime/composables/useConvexMutation'
import type { CallResult } from '../../src/runtime/errors'
import { normalizeConvexError } from '../../src/runtime/errors'

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

type _MutationNestedSafe = Assert<
  IsEqual<
    Awaited<
      ReturnType<
        UseConvexMutationReturn<MutationRef<{ id: string }, CallResult<{ id: string }>>>['safe']
      >
    >,
    CallResult<CallResult<{ id: string }>>
  >
>

type _MutationCallable = Assert<IsEqual<Awaited<ReturnType<MutationReturn>>, { id: string }>>
type _MutationCallableArgs = Assert<IsEqual<Parameters<MutationReturn>, [args: { id: string }]>>
type _ArglessMutationCallableArgs = Assert<
  IsEqual<Parameters<UseConvexMutationReturn<MutationRef<Argless, string>>>, [args?: Argless]>
>
type _MutationHasNoExecute = Assert<IsEqual<HasKey<MutationReturn, 'execute'>, false>>
type _MutationHasNoExecuteSafe = Assert<IsEqual<HasKey<MutationReturn, 'executeSafe'>, false>>

type _ActionNestedSafe = Assert<
  IsEqual<
    Awaited<
      ReturnType<
        UseConvexActionReturn<ActionRef<{ id: string }, CallResult<{ id: string }>>>['safe']
      >
    >,
    CallResult<CallResult<{ id: string }>>
  >
>

type _ActionCallable = Assert<IsEqual<Awaited<ReturnType<ActionReturn>>, { id: string }>>
type _ActionCallableArgs = Assert<IsEqual<Parameters<ActionReturn>, [args: { id: string }]>>
type _ArglessActionCallableArgs = Assert<
  IsEqual<Parameters<UseConvexActionReturn<ActionRef<Argless, string>>>, [args?: Argless]>
>
type _ActionHasNoExecute = Assert<IsEqual<HasKey<ActionReturn, 'execute'>, false>>
type _ActionHasNoExecuteSafe = Assert<IsEqual<HasKey<ActionReturn, 'executeSafe'>, false>>

describe('CallResult type contracts', () => {
  it('keeps nested safe result typing for domain CallResult endpoints', () => {
    expect(true).toBe(true)
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

  it('derives code from a Convex application error, preserving its data verbatim', () => {
    // Structured extraction requires the pinned ConvexError contract :
    // a plain Error carrying a `.data` bag is NOT treated as a Convex application
    // error and stays `unknown`. A real ConvexError becomes `server` with its
    // `data.code` surfaced and its data preserved.
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
    expect(structured.message).toBe('Convex application error')
    expect(structured.code).toBe('LIMIT_ITEMS')
    expect(structured.data).toEqual({ message: 'Limit reached', code: 'LIMIT_ITEMS' })
  })
})
