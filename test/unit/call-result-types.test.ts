import type { FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'

import type { UseConvexCall } from '../../packages/vue/src'
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

type MutationReturn = UseConvexCall<MutationRef<{ id: string }, { id: string }>>
type ActionReturn = UseConvexCall<ActionRef<{ id: string }, { id: string }>>

type _MutationCallable = Assert<IsEqual<Awaited<ReturnType<MutationReturn>>, { id: string }>>
type _MutationCallableArgs = Assert<IsEqual<Parameters<MutationReturn>, [args: { id: string }]>>
type _ArglessMutationCallableArgs = Assert<
  IsEqual<Parameters<UseConvexCall<MutationRef<Argless, string>>>, [args?: Argless]>
>
type _MutationHasNoExecute = Assert<IsEqual<HasKey<MutationReturn, 'execute'>, false>>
type _MutationHasNoSafe = Assert<IsEqual<HasKey<MutationReturn, 'safe'>, false>>
type _MutationHasNoReset = Assert<IsEqual<HasKey<MutationReturn, 'reset'>, false>>

type _ActionCallable = Assert<IsEqual<Awaited<ReturnType<ActionReturn>>, { id: string }>>
type _ActionCallableArgs = Assert<IsEqual<Parameters<ActionReturn>, [args: { id: string }]>>
type _ArglessActionCallableArgs = Assert<
  IsEqual<Parameters<UseConvexCall<ActionRef<Argless, string>>>, [args?: Argless]>
>
type _ActionHasNoExecute = Assert<IsEqual<HasKey<ActionReturn, 'execute'>, false>>
type _ActionHasNoSafe = Assert<IsEqual<HasKey<ActionReturn, 'safe'>, false>>
type _ActionHasNoReset = Assert<IsEqual<HasKey<ActionReturn, 'reset'>, false>>

describe('callable and error type contracts', () => {
  it('keeps one named direct-call contract without alternate execution paths', () => {
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
