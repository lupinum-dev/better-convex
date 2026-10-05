import type { StandardSchemaV1 } from '@standard-schema/spec'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, isProxy, isReadonly, ref } from 'vue'
import { z } from 'zod'

import { createBetterConvex, useConvexForm, useConvexOperation } from '../../packages/vue/src'
import { ConvexCallError, isConvexCallError } from '../../packages/vue/src/errors'
import { createBetterConvexBrowserRuntime } from '../../packages/vue/src/internal/browser-runtime'
import type { OwnedConvexClient } from '../../packages/vue/src/internal/client-owner'
import { createBetterAuthBrowserAdapter } from '../../src/runtime/auth/better-auth-browser-adapter'
import { attachedVueHost } from '../helpers/attached-vue-host'
import { MockConvexClient } from '../helpers/mock-convex-client'

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

/** A schema whose validation waits until the test releases it. */
function gatedSchema() {
  let release: (() => void) | undefined
  const schema: StandardSchemaV1<FormValues, FormValues> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async (value) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { value: value as FormValues }
      },
    },
  }
  return { schema, started: () => release !== undefined, release: () => release?.() }
}

function setup(
  invoke: (args: SaveArgs) => Promise<SaveResult>,
  schema: StandardSchemaV1<FormValues, FormValues> = formSchema,
) {
  const mutation = vi.fn(async (_reference: unknown, args: SaveArgs) => invoke(args))
  const host = attachedVueHost({ mutation })
  const form = host.run(() =>
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
  )
  return { form, mutation, stop: host.stop, advanceIdentity: host.advanceIdentity }
}

describe('useConvexForm', () => {
  it('sends a submission made before the first auth result once it finds no session', async () => {
    // Real provider adapter, identity port, client owner, form and operation;
    // only the Better Auth session source and the Convex transport are doubles.
    const session = ref({ isPending: true, data: null, error: null })
    const adapter = createBetterAuthBrowserAdapter({
      useSession: () => session,
      convex: { token: vi.fn(async () => ({ data: null })) },
    })
    const clients: MockConvexClient[] = []
    const runtime = createBetterConvexBrowserRuntime({
      auth: adapter,
      clientFactory: () => {
        const client = new MockConvexClient()
        client.setMutationHandler('accounts:save', () => ({ id: 'checkpoint-startup' }))
        clients.push(client)
        return Object.assign(client, { close: async () => {} }) as unknown as OwnedConvexClient
      },
    })
    const app = createApp({})
    app.use(createBetterConvex({ attachment: runtime.attachment }))
    const scope = effectScope()
    const { form, operation } = app.runWithContext(() =>
      scope.run(() => ({
        form: useConvexForm(saveReference, {
          schema: formSchema,
          toArgs: (values) => ({ balanceCents: values.balance * 100, note: values.note }),
        }),
        operation: useConvexOperation(async () => {
          throw new ConvexCallError({ kind: 'unknown', code: 'PREFLIGHT', message: 'Preflight' })
        }),
      })),
    )!
    const sent = () => clients.reduce((total, client) => total + client.calls.mutation.length, 0)
    try {
      await expect(operation.run()).rejects.toMatchObject({ code: 'PREFLIGHT' })
      const submission = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(sent()).toBe(0)

      session.value = { isPending: false, data: null, error: null }

      await expect(submission).resolves.toEqual({ ok: true, data: { id: 'checkpoint-startup' } })
      expect(sent()).toBe(1)
      // No user changed, so identity-owned state stays.
      expect(operation.error.value).toMatchObject({ code: 'PREFLIGHT' })
    } finally {
      scope.stop()
      await runtime.dispose()
      adapter.dispose()
    }
  })

  it('validates external values, transforms them, and adds typed context', async () => {
    const { form, mutation, stop } = setup(async () => ({ id: 'checkpoint-1' }))
    // The verbs are function properties, so destructuring keeps them bound.
    const { submit, status, data, reset } = form

    const result = await submit({ balance: 12.34, note: '' }, { accountId: 'account-1' })

    expect(result).toEqual({ ok: true, data: { id: 'checkpoint-1' } })
    expect(mutation).toHaveBeenCalledWith(saveReference, {
      accountId: 'account-1',
      balanceCents: 1234,
      note: undefined,
    })
    expect(status.value).toBe('success')
    expect(data.value).toEqual({ id: 'checkpoint-1' })
    reset()
    expect(status.value).toBe('idle')
    stop()
  })

  it('exposes the exact mutation result and returned form error, not proxies', async () => {
    const saved: SaveResult = { id: 'checkpoint-exact' }
    const { form, stop } = setup(async () => saved)

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
    stop()
  })

  it('routes known validation paths and never invokes the mutation', async () => {
    const { form, mutation, stop } = setup(async () => ({ id: 'unused' }))

    const result = await form.submit({ balance: -1, note: '' }, { accountId: 'account-1' })

    expect(result.ok).toBe(false)
    expect(form.fieldErrors.value.balance).toEqual(['Enter a positive balance'])
    expect(form.issues.value[0]).toMatchObject({ field: 'balance', path: ['balance'] })
    expect(form.status.value).toBe('error')
    expect(mutation).not.toHaveBeenCalled()
    stop()
  })

  it('rejects a concurrent submission without a second mutation or state change', async () => {
    let release!: (value: SaveResult) => void
    const { form, mutation, stop } = setup(
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
    stop()
  })

  it('keeps pending through async validation and submits the entry snapshot', async () => {
    const validation = gatedSchema()
    const { form, mutation, stop } = setup(async () => ({ id: 'checkpoint-1' }), validation.schema)
    const values = { balance: 4.2, note: 'original' }

    const pending = form.submit(values, { accountId: 'account-1' })
    values.balance = 99
    values.note = 'changed'
    expect(form.pending.value).toBe(true)
    expect(mutation).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(validation.started()).toBe(true))
    validation.release()
    await pending

    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      accountId: 'account-1',
      balanceCents: 420,
      note: 'original',
    })
    stop()
  })

  it('returns to idle on reset and retires the pending submission', async () => {
    const releases: Array<(value: SaveResult) => void> = []
    const { form, mutation, stop } = setup(
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
    stop()
  })

  it('does not repopulate state after disposal during submission', async () => {
    let release!: (value: SaveResult) => void
    const { form, mutation, stop } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))

    stop()
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
    const { form, mutation, stop, advanceIdentity } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))

    advanceIdentity()
    // In-flight state returns to idle as soon as the identity changes.
    expect(form.status.value).toBe('idle')
    expect(form.pending.value).toBe(false)
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
    stop()
  })

  it('binds a submission to the identity current at submit, not at creation', async () => {
    const { form, mutation, stop, advanceIdentity } = setup(async () => ({ id: 'bob-write' }))

    // Created under Alice; Bob signs in before the first submission.
    advanceIdentity()
    const result = await form.submit({ balance: 1, note: '' }, { accountId: 'bob-account' })

    expect(result).toEqual({ ok: true, data: { id: 'bob-write' } })
    expect(mutation).toHaveBeenCalledTimes(1)
    stop()
  })

  it('never dispatches values validated under a replaced identity', async () => {
    const validation = gatedSchema()
    const { form, mutation, stop, advanceIdentity } = setup(
      async () => ({ id: 'bob-write' }),
      validation.schema,
    )

    // Alice submits; validation is still pending when Bob signs in.
    const pending = form.submit({ balance: 1, note: 'alice' }, { accountId: 'alice-account' })
    await vi.waitFor(() => expect(validation.started()).toBe(true))
    advanceIdentity()
    validation.release()
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
    stop()
  })

  it('never dispatches a submission reset during async validation', async () => {
    const validation = gatedSchema()
    const { form, mutation, stop } = setup(async () => ({ id: 'unused' }), validation.schema)

    const pending = form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    await vi.waitFor(() => expect(validation.started()).toBe(true))
    form.reset()
    validation.release()
    const result = await pending

    expect(mutation.mock.calls).toEqual([])
    expect(result).toMatchObject({
      ok: false,
      error: { callError: { code: 'CANCELLED', outcome: 'not-sent' } },
    })
    expect(form.status.value).toBe('idle')
    expect(form.error.value).toBeUndefined()
    stop()
  })

  it('clears settled success and failure state when the identity changes', async () => {
    let outcome: 'ok' | 'fail' = 'ok'
    const { form, stop, advanceIdentity } = setup(async () => {
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
    stop()
  })

  it('rejects overlapping runtime arguments and releases its guard', async () => {
    const { form, mutation, stop } = setup(async () => ({ id: 'unused' }))

    await expect(
      form.submit({ balance: 1, note: '' }, { accountId: 'account-1', balanceCents: 1 } as never),
    ).rejects.toThrow('form and contextual mutation arguments overlap')
    expect(form.pending.value).toBe(false)
    expect(form.status.value).toBe('idle')
    expect(mutation).not.toHaveBeenCalled()
    stop()
  })

  it('maps normalized server failures without exposing raw causes', async () => {
    const { form, stop } = setup(async () => {
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
    stop()
  })

  it('keeps developer-authored application text on the call error', async () => {
    const { form, stop } = setup(async () => {
      throw new ConvexError({ code: 'LOCKED', message: 'The account is locked' })
    })
    const unmapped = await form.submit({ balance: 1, note: '' }, { accountId: 'account-1' })
    expect(unmapped.ok).toBe(false)
    // The fixture mapper maps every non-BAD_NOTE code to a fixed form message.
    expect(form.formError.value).toBe('Could not save the checkpoint')
    if (unmapped.ok) throw new Error('Expected form failure')
    expect(unmapped.error.callError?.message).toBe('The account is locked')
    stop()
  })

  it('clears the previous failure and succeeds when retried', async () => {
    let attempt = 0
    const { form, mutation, stop } = setup(async () => {
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
    stop()
  })
})
