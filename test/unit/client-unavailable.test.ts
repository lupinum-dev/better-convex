import { inspect } from 'node:util'

import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { isReactive, isRef, markRaw, reactive, ref, toRaw } from 'vue'

import { ConvexCallError } from '../../src/runtime/errors'
import {
  UNAVAILABLE_AUTH_CLIENT,
  UNAVAILABLE_CONVEX_HANDLE,
} from '../../src/runtime/utils/client-unavailable'

const listNotes = makeFunctionReference<'query'>('notes:list')
const createNote = makeFunctionReference<'mutation'>('notes:create')
const sendEmail = makeFunctionReference<'action'>('emails:send')

function thrownBy(run: () => unknown): ConvexCallError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexCallError)
    return error as ConvexCallError
  }
  throw new Error('expected a CLIENT_UNAVAILABLE error')
}

describe('unavailable useConvex() handle', () => {
  it('rejects every operation with CLIENT_UNAVAILABLE and the function name', async () => {
    const handle = UNAVAILABLE_CONVEX_HANDLE

    expect(Object.isFrozen(handle)).toBe(true)
    expect(Object.keys(handle).sort()).toEqual(['action', 'mutation', 'onUpdate', 'query'])
    await expect(handle.query(listNotes, {})).rejects.toMatchObject({
      kind: 'unknown',
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'notes:list',
    })
    await expect(handle.mutation(createNote, {})).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'notes:create',
    })
    await expect(handle.action(sendEmail, {})).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
      functionName: 'emails:send',
    })
    const error = thrownBy(() => handle.onUpdate(listNotes, {}, () => {}))
    expect(error.code).toBe('CLIENT_UNAVAILABLE')
    expect(error.functionName).toBe('notes:list')
    expect(error.message).toContain('useConvex().onUpdate()')
  })
})

/** Every member path of the inert client is itself a callable inert node. */
interface InertClientNode {
  (...args: unknown[]): unknown
  readonly signIn: InertClientNode
  readonly signOut: InertClientNode
  readonly useSession: InertClientNode
  readonly organization: InertClientNode
  readonly members: InertClientNode
  readonly list: InertClientNode
  readonly email: InertClientNode
  readonly then?: unknown
  readonly toJSON?: unknown
}

describe('unavailable useConvexAuth().client', () => {
  const client = UNAVAILABLE_AUTH_CLIENT as InertClientNode

  it('allows destructuring and nested reads without throwing', () => {
    const { signIn, signOut, useSession, organization } = client

    expect(typeof signIn.email).toBe('function')
    expect(typeof signOut).toBe('function')
    expect(typeof useSession).toBe('function')
    expect(typeof organization.members.list).toBe('function')
    expect('signIn' in client).toBe(false)
    expect(Object.keys(client)).toEqual([])
  })

  it('throws CLIENT_UNAVAILABLE naming the member that was called', () => {
    const email = thrownBy(() => client.signIn.email({ email: 'a@example.test', password: 'x' }))
    expect(email).toMatchObject({ kind: 'unknown', code: 'CLIENT_UNAVAILABLE' })
    expect(email.message).toContain('useConvexAuth().client.signIn.email()')

    expect(thrownBy(() => client.useSession()).message).toContain('client.useSession()')
    expect(thrownBy(() => (client as unknown as () => void)()).message).toContain(
      'useConvexAuth().client()',
    )
  })

  it('is neither thenable nor serializable into a new proxy chain', async () => {
    expect(client.then).toBeUndefined()
    await expect(Promise.resolve(client as unknown)).resolves.toBe(client)
    expect(client.toJSON).toBeUndefined()
    expect(JSON.stringify({ client })).toBe('{}')
    expect(String(client)).toBe('[better-convex-nuxt: auth client unavailable]')
    expect(`${client.signIn}`).toBe('[better-convex-nuxt: auth client unavailable]')
    expect(() => inspect(client, { depth: 4 })).not.toThrow()
  })

  it('stays a plain non-reactive value inside Vue state', () => {
    expect(isRef(client)).toBe(false)
    expect(isReactive(client)).toBe(false)
    expect(toRaw(client)).toBe(client)
    expect(markRaw(client)).toBe(client)
    expect(reactive({ client }).client).toBe(client)
    expect(ref(client).value).toBe(client)
    expect(isReactive(reactive({ client }).client)).toBe(false)
  })

  it('rejects writes so the stand-in cannot be patched into a fake client', () => {
    expect(Reflect.set(client, 'signIn', {})).toBe(false)
    expect(Reflect.defineProperty(client, 'signIn', { value: {} })).toBe(false)
    expect(Reflect.deleteProperty(client, 'signIn')).toBe(false)
    expect(typeof client.signIn.email).toBe('function')
  })
})
