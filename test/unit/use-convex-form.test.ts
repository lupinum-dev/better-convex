import type { StandardSchemaV1 } from '@standard-schema/spec'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope } from 'vue'
import { z } from 'zod'

import { createBetterConvex, useConvexForm } from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'

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
    expect(mutation).toHaveBeenCalledWith(
      saveReference,
      { accountId: 'account-1', balanceCents: 1234, note: undefined },
      { optimisticUpdate: undefined },
    )
    expect(form.status.value).toBe('success')
    expect(form.data.value).toEqual({ id: 'checkpoint-1' })
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

  it('returns one active promise and performs one mutation for duplicate submissions', async () => {
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

    expect(duplicate).toBe(first)
    expect(form.pending.value).toBe(true)
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    release({ id: 'checkpoint-1' })
    await expect(first).resolves.toEqual({ ok: true, data: { id: 'checkpoint-1' } })
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      accountId: 'account-1',
      balanceCents: 100,
      note: 'first',
    })
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

  it('keeps reset final while the underlying mutation settles', async () => {
    let release!: (value: SaveResult) => void
    const { form, mutation, scope } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))

    form.reset()
    expect(form.status.value).toBe('pending')
    expect(form.data.value).toBeUndefined()
    release({ id: 'retired' })
    await pending

    expect(form.pending.value).toBe(false)
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

    expect(result).toMatchObject({ ok: false, error: { callError: { code: 'IDENTITY_CHANGED' } } })
    expect(form.status.value).toBe('idle')
    expect(form.data.value).toBeUndefined()
    expect(form.error.value).toBeUndefined()
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
    expect(form.fieldErrors.value.note).toEqual(['The note is not allowed'])
    expect(form.formError.value).toBeUndefined()
    expect(JSON.stringify(result.error)).not.toContain('cause')
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
