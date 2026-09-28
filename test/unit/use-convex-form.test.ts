import type { StandardSchemaV1 } from '@standard-schema/spec'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, isProxy, isReadonly } from 'vue'
import { z } from 'zod'

import { createBetterConvex, useConvexForm } from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import { ConvexCallError, isConvexCallError } from '../../packages/vue/src/errors'

type SaveArgs = {
  accountId: string
  balanceCents: number
  note?: string
}
type SaveResult = { id: string }
type FormValues = { balance: number; note: string }

const saveReference = makeFunctionReference<'mutation'>('accounts:save') as FunctionReference<
  'mutation',
  'public',
  SaveArgs,
  SaveResult
>

const formSchema: StandardSchemaV1<FormValues, FormValues> = z.object({
  balance: z.number().positive('Enter a positive balance'),
  note: z.string(),
})

function setup(
  invoke: (args: SaveArgs) => Promise<SaveResult>,
  schema: StandardSchemaV1<FormValues, FormValues> = formSchema,
) {
  const mutation = vi.fn(async (_reference: unknown, args: SaveArgs) => invoke(args))
  let identityGeneration = 1
  const identityListeners = new Set<() => void>()
  const client = {
    query: vi.fn() as never,
    mutation: mutation as never,
    action: vi.fn() as never,
    onUpdate: vi.fn(() => () => {}) as never,
  }
  const attachment = createBetterConvexAttachment({
    client,
    anonymousClient: client,
    identity: {
      snapshot: () => ({
        authEnabled: true,
        settled: true,
        identityKey: 'user:test',
        identityGeneration,
        error: null,
      }),
      waitForInitialSettlement: async () => {},
      subscribe(listener) {
        identityListeners.add(listener)
        return () => identityListeners.delete(listener)
      },
    },
  })
  const app = createApp({})
  app.use(createBetterConvex({ attachment }))
  const scope = effectScope()
  const form = app.runWithContext(() =>
    scope.run(() =>
      useConvexForm(saveReference, {
        schema,
        toArgs: (values) => ({
          balanceCents: Math.round(values.balance * 100),
          note: values.note || undefined,
        }),
        mapError: (error) =>
          error.code === 'BAD_NOTE'
            ? { fields: { note: 'The note is not allowed' } }
            : { form: 'Could not save the checkpoint' },
      }),
    ),
  )!
  return {
    form,
    mutation,
    scope,
    advanceIdentity() {
      identityGeneration += 1
      for (const listener of identityListeners) listener()
    },
  }
}

describe('useConvexForm', () => {
  it('validates external values, transforms them, and adds typed context', async () => {
    const { form, mutation, scope } = setup(async () => ({ id: 'checkpoint-1' }))

    const result = await form.submit({ balance: 12.34, note: '' }, { accountId: 'account-1' })

    expect(result).toEqual({ ok: true, data: { id: 'checkpoint-1' } })
    expect(mutation).toHaveBeenCalledWith(saveReference, {
      accountId: 'account-1',
      balanceCents: 1234,
      note: undefined,
    })
    expect(form.status.value).toBe('success')
    expect(form.data.value).toEqual({ id: 'checkpoint-1' })
    scope.stop()
  })

  it('exposes the exact mutation result and returned form error, not proxies', async () => {
    const saved: SaveResult = { id: 'checkpoint-exact' }
    const { form, scope } = setup(async () => saved)

    const success = await form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    expect(success).toEqual({ ok: true, data: saved })
    expect(form.data.value).toBe(saved)
    expect(isProxy(form.data.value)).toBe(false)
    expect(isReadonly(form.data)).toBe(true)

    const failure = await form.submit({ balance: -1, note: '' }, { accountId: 'account-1' })
    expect(failure.ok).toBe(false)
    expect(form.error.value).toBe(failure.ok ? undefined : failure.error)
    expect(isProxy(form.error.value)).toBe(false)
    expect(isReadonly(form.error)).toBe(true)
    scope.stop()
  })

  it('routes known validation paths and never invokes the mutation', async () => {
    const { form, mutation, scope } = setup(async () => ({ id: 'unused' }))

    const result = await form.submit({ balance: -1, note: '' }, { accountId: 'account-1' })

    expect(result.ok).toBe(false)
    expect(form.fieldErrors.value.balance).toEqual(['Enter a positive balance'])
    expect(form.issues.value[0]).toMatchObject({ field: 'balance', path: ['balance'] })
    expect(form.status.value).toBe('error')
    expect(mutation).not.toHaveBeenCalled()
    scope.stop()
  })

  it('rejects a concurrent submission without a second mutation or state change', async () => {
    let release!: (value: SaveResult) => void
    const { form, mutation, scope } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )

    // Read before submission to prove Vue invalidates the cached computed value.
    expect(form.pending.value).toBe(false)
    const first = form.submit({ balance: 1, note: 'first' }, { accountId: 'account-1' })
    const duplicate = form.submit({ balance: 2, note: 'second' }, { accountId: 'account-2' })

    const rejection = await duplicate.catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(ConvexCallError)
    expect(isConvexCallError(rejection, 'SUBMIT_IN_PROGRESS')).toBe(true)
    expect(rejection).toMatchObject({ kind: 'unknown', functionName: 'accounts:save' })
    expect(form.pending.value).toBe(true)
    expect(form.error.value).toBeUndefined()

    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    release({ id: 'checkpoint-1' })
    await expect(first).resolves.toEqual({ ok: true, data: { id: 'checkpoint-1' } })
    expect(mutation).toHaveBeenCalledTimes(1)
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      accountId: 'account-1',
      balanceCents: 100,
      note: 'first',
    })

    // The guard is released once the first submission settles.
    const next = form.submit({ balance: 3, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2))
    release({ id: 'checkpoint-2' })
    await expect(next).resolves.toEqual({ ok: true, data: { id: 'checkpoint-2' } })
    scope.stop()
  })

  it('keeps pending through async validation and submits the entry snapshot', async () => {
    let releaseValidation!: () => void
    const asyncSchema: StandardSchemaV1<FormValues, FormValues> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => {
          await new Promise<void>((resolve) => {
            releaseValidation = resolve
          })
          return { value: value as FormValues }
        },
      },
    }
    const { form, mutation, scope } = setup(async () => ({ id: 'checkpoint-1' }), asyncSchema)
    const values = { balance: 4.2, note: 'original' }

    const pending = form.submit(values, { accountId: 'account-1' })
    values.balance = 99
    values.note = 'changed'
    expect(form.pending.value).toBe(true)
    expect(mutation).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(releaseValidation).toBeTypeOf('function'))
    releaseValidation()
    await pending

    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      accountId: 'account-1',
      balanceCents: 420,
      note: 'original',
    })
    scope.stop()
  })

  it('returns to idle on reset and retires the pending submission', async () => {
    const releases: Array<(value: SaveResult) => void> = []
    const { form, mutation, scope } = setup(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        }),
    )
    const retired = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))

    form.reset()
    expect(form.status.value).toBe('idle')
    expect(form.pending.value).toBe(false)
    expect(form.data.value).toBeUndefined()

    // A reset form accepts a new submission while the retired one is in flight.
    const current = form.submit({ balance: 2, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2))
    releases[0]!({ id: 'retired' })
    await expect(retired).resolves.toEqual({ ok: true, data: { id: 'retired' } })
    expect(form.status.value).toBe('pending')
    expect(form.data.value).toBeUndefined()

    releases[1]!({ id: 'current' })
    await expect(current).resolves.toEqual({ ok: true, data: { id: 'current' } })
    expect(form.status.value).toBe('success')
    expect(form.data.value).toEqual({ id: 'current' })

    form.reset()
    expect(form.status.value).toBe('idle')
    expect(form.data.value).toBeUndefined()
    expect(form.error.value).toBeUndefined()
    scope.stop()
  })

  it('does not repopulate state after disposal during submission', async () => {
    let release!: (value: SaveResult) => void
    const { form, mutation, scope } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))

    scope.stop()
    expect(form.status.value).toBe('idle')
    release({ id: 'retired' })
    await expect(pending).resolves.toEqual({ ok: true, data: { id: 'retired' } })

    expect(form.status.value).toBe('idle')
    expect(form.pending.value).toBe(false)
    expect(form.data.value).toBeUndefined()
    expect(form.error.value).toBeUndefined()
  })

  it('does not commit a completion from a replaced identity', async () => {
    let release!: (value: SaveResult) => void
    const { form, mutation, scope, advanceIdentity } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))

    advanceIdentity()
    release({ id: 'old-identity' })
    const result = await pending

    // Sent under the old identity: it may have committed.
    expect(result).toMatchObject({
      ok: false,
      error: { callError: { code: 'IDENTITY_CHANGED', outcome: 'unknown' } },
    })
    expect(form.status.value).toBe('idle')
    expect(form.data.value).toBeUndefined()
    expect(form.error.value).toBeUndefined()
    scope.stop()
  })

  it('binds a submission to the identity current at submit, not at creation', async () => {
    const { form, mutation, scope, advanceIdentity } = setup(async () => ({ id: 'bob-write' }))

    // Created under Alice; Bob signs in before the first submission.
    advanceIdentity()
    const result = await form.submit({ balance: 1, note: '' }, { accountId: 'bob-account' })

    expect(result).toEqual({ ok: true, data: { id: 'bob-write' } })
    expect(mutation).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('never dispatches values validated under a replaced identity', async () => {
    let releaseValidation!: () => void
    const asyncSchema: StandardSchemaV1<FormValues, FormValues> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => {
          await new Promise<void>((resolve) => {
            releaseValidation = resolve
          })
          return { value: value as FormValues }
        },
      },
    }
    const { form, mutation, scope, advanceIdentity } = setup(
      async () => ({ id: 'bob-write' }),
      asyncSchema,
    )

    // Alice submits; validation is still pending when Bob signs in.
    const pending = form.submit({ balance: 1, note: 'alice' }, { accountId: 'alice-account' })
    await vi.waitFor(() => expect(releaseValidation).toBeTypeOf('function'))
    advanceIdentity()
    releaseValidation()
    const result = await pending

    expect(mutation.mock.calls).toEqual([])
    expect(result).toMatchObject({
      ok: false,
      error: {
        callError: {
          kind: 'authentication',
          code: 'IDENTITY_CHANGED',
          functionName: 'accounts:save',
          outcome: 'not-sent',
        },
      },
    })
    expect(form.status.value).toBe('idle')
    expect(form.data.value).toBeUndefined()
    expect(form.error.value).toBeUndefined()
    scope.stop()
  })

  it('never dispatches a submission reset during async validation', async () => {
    let releaseValidation!: () => void
    const asyncSchema: StandardSchemaV1<FormValues, FormValues> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => {
          await new Promise<void>((resolve) => {
            releaseValidation = resolve
          })
          return { value: value as FormValues }
        },
      },
    }
    const { form, mutation, scope } = setup(async () => ({ id: 'unused' }), asyncSchema)

    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(releaseValidation).toBeTypeOf('function'))
    form.reset()
    releaseValidation()
    const result = await pending

    expect(mutation.mock.calls).toEqual([])
    expect(result).toMatchObject({
      ok: false,
      error: { callError: { code: 'CANCELLED', outcome: 'not-sent' } },
    })
    expect(form.status.value).toBe('idle')
    expect(form.error.value).toBeUndefined()
    scope.stop()
  })

  it('clears settled success and failure state when the identity changes', async () => {
    let outcome: 'ok' | 'fail' = 'ok'
    const { form, scope, advanceIdentity } = setup(async () => {
      if (outcome === 'fail') throw new ConvexError({ code: 'BAD_NOTE' })
      return { id: 'user-a' }
    })

    await form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    expect(form.data.value).toEqual({ id: 'user-a' })
    advanceIdentity()
    expect(form.status.value).toBe('idle')
    expect(form.data.value).toBeUndefined()

    outcome = 'fail'
    await form.submit({ balance: 1, note: 'forbidden' }, { accountId: 'account-1' })
    expect(form.fieldErrors.value.note).toEqual(['The note is not allowed'])
    advanceIdentity()
    expect(form.status.value).toBe('idle')
    expect(form.error.value).toBeUndefined()
    expect(form.fieldErrors.value).toEqual({})
    expect(form.formError.value).toBeUndefined()
    scope.stop()
  })

  it('returns an in-flight submission to idle as soon as the identity changes', async () => {
    const { form, mutation, scope, advanceIdentity } = setup(() => new Promise(() => {}))
    void form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    expect(form.pending.value).toBe(true)

    advanceIdentity()
    expect(form.status.value).toBe('idle')
    expect(form.pending.value).toBe(false)
    scope.stop()
  })

  it('rejects overlapping runtime arguments and releases its guard', async () => {
    const { form, mutation, scope } = setup(async () => ({ id: 'unused' }))

    await expect(
      form.submit({ balance: 1, note: '' }, { accountId: 'account-1', balanceCents: 1 } as never),
    ).rejects.toThrow('form and contextual mutation arguments overlap')
    expect(form.pending.value).toBe(false)
    expect(form.status.value).toBe('idle')
    expect(mutation).not.toHaveBeenCalled()
    scope.stop()
  })

  it('maps normalized server failures without exposing raw causes', async () => {
    const { form, scope } = setup(async () => {
      throw new ConvexError({ code: 'BAD_NOTE', private: 'structured-application-data' })
    })

    const result = await form.submit({ balance: 1, note: 'forbidden' }, { accountId: 'account-1' })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected form failure')
    expect(result.error.kind).toBe('submission')
    expect(result.error.callError?.code).toBe('BAD_NOTE')
    expect(result.error.callError?.functionName).toBe('accounts:save')
    expect(form.fieldErrors.value.note).toEqual(['The note is not allowed'])
    expect(form.formError.value).toBeUndefined()
    expect(JSON.stringify(result.error)).not.toContain('cause')
    scope.stop()
  })

  it('keeps developer-authored application text on the call error', async () => {
    const { form, scope } = setup(async () => {
      throw new ConvexError({ code: 'LOCKED', message: 'The account is locked' })
    })
    const unmapped = await form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    expect(unmapped.ok).toBe(false)
    // The fixture mapper maps every non-BAD_NOTE code to a fixed form message.
    expect(form.formError.value).toBe('Could not save the checkpoint')
    if (unmapped.ok) throw new Error('Expected form failure')
    expect(unmapped.error.callError?.message).toBe('The account is locked')
    scope.stop()
  })

  it('returns a destructurable object', async () => {
    const { form, scope } = setup(async () => ({ id: 'checkpoint-1' }))
    const { submit, status, data, reset } = form
    await submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    expect(status.value).toBe('success')
    expect(data.value).toEqual({ id: 'checkpoint-1' })
    reset()
    expect(status.value).toBe('idle')
    scope.stop()
  })

  it('clears the previous failure and succeeds when retried', async () => {
    let attempt = 0
    const { form, mutation, scope } = setup(async () => {
      attempt += 1
      if (attempt === 1) {
        throw new ConvexError({ code: 'BAD_NOTE' })
      }
      return { id: 'checkpoint-2' }
    })

    const first = await form.submit({ balance: 1, note: 'forbidden' }, { accountId: 'account-1' })
    expect(first.ok).toBe(false)
    expect(form.fieldErrors.value.note).toEqual(['The note is not allowed'])

    const retry = form.submit({ balance: 2, note: 'allowed' }, { accountId: 'account-1' })
    expect(form.status.value).toBe('pending')
    expect(form.error.value).toBeUndefined()
    await expect(retry).resolves.toEqual({ ok: true, data: { id: 'checkpoint-2' } })

    expect(mutation).toHaveBeenCalledTimes(2)
    expect(form.status.value).toBe('success')
    expect(form.data.value).toEqual({ id: 'checkpoint-2' })
    expect(form.fieldErrors.value).toEqual({})
    scope.stop()
  })
})
