/// <reference types="vite/client" />

import { makeFunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'

import deletePathsSchema from '../fixtures/auth-delete-paths/convex/schema'
import {
  authComponent,
  createRealAuth,
  type RealAuthSetup,
  useAuthEnvironment,
} from '../helpers/real-auth'

const deletePaths = {
  schema: deletePathsSchema,
  modules: import.meta.glob('../fixtures/auth-delete-paths/convex/**/*.ts'),
}
const deletedAuthUsers = makeFunctionReference<'query', Record<string, never>, string[]>(
  'auth:deletedAuthUsers',
)

const credentials = { email: 'person@example.test', password: 'synthetic-password-for-delete' }

type Options = Parameters<typeof createRealAuth>[0]

/** Without `mail`, the app sends no email, so deletion needs a fresh session or the password. */
function setup(options: Options, mail?: 'mail', root?: RealAuthSetup['root']) {
  const real = createRealAuth(
    { emailAndPassword: { requireEmailVerification: false }, ...options },
    { ...(mail ? {} : { email: false }), ...(root ? { root } : {}) },
  )
  const browser = real.client('198.51.100.7')
  const request = (method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) =>
    method === 'POST' ? browser.post(path, body ?? {}) : browser.get(path)
  async function signIn() {
    expect(
      (await request('POST', '/sign-up/email', { name: 'Person', ...credentials })).status,
    ).toBe(200)
    expect((await request('POST', '/sign-in/email', credentials)).status).toBe(200)
  }
  const users = async () => (await real.users()).page
  async function ageSession(ms: number) {
    await real.test.mutation(authComponent.adapter.updateOne, {
      model: 'session',
      where: [{ field: 'userId', value: (await users())[0]!.id as string }],
      update: { createdAt: Date.now() - ms },
    })
  }
  return { ...real, request, signIn, users, ageSession }
}

describe('account deletion with real Better Auth', () => {
  useAuthEnvironment()

  // Catches: the delete route being reachable when the app never asked for it.
  it('is off unless the app enables it', async () => {
    const { request, signIn, users } = setup({})
    await signIn()
    expect((await request('POST', '/delete-user', {})).status).toBe(404)
    expect(await users()).toHaveLength(1)
  })

  it('also stays off for deleteUser: { enabled: false }', async () => {
    const { request, signIn, users } = setup({ deleteUser: { enabled: false } })
    await signIn()
    expect((await request('POST', '/delete-user', {})).status).toBe(404)
    expect(await users()).toHaveLength(1)
  })

  // Catches: deletion that does not delete, or that skips beforeDelete.
  it('deletes the auth user for a fresh session after beforeDelete allowed it', async () => {
    const beforeDelete = vi.fn(async () => {})
    const { request, signIn, users, sessions, accounts } = setup({
      deleteUser: { enabled: true, beforeDelete },
    })
    await signIn()
    const response = await request('POST', '/delete-user', {})
    expect(response).toMatchObject({
      status: 200,
      body: { success: true, message: 'User deleted' },
    })
    expect(await users()).toHaveLength(0)
    // A session or sign-in method left behind would outlive the account.
    expect((await sessions()).page).toEqual([])
    expect((await accounts()).page).toEqual([])
    expect(beforeDelete).toHaveBeenCalledOnce()
    const [ctx, user] = beforeDelete.mock.calls[0] as unknown as [
      { runQuery: unknown },
      { email: string; id: string; name: string },
    ]
    expect(ctx.runQuery).toBeTypeOf('function')
    expect(user).toMatchObject({ email: credentials.email, name: 'Person' })
    expect(Object.isFrozen(user)).toBe(true)
  })

  // Catches: a refusal that still deletes, or leaks an internal error text.
  async function refused(error: Error) {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { request, signIn, users } = setup({
      deleteUser: {
        enabled: true,
        beforeDelete: async () => {
          throw error
        },
      },
    })
    await signIn()
    const response = await request('POST', '/delete-user', {})
    expect(await users()).toHaveLength(1)
    return response
  }

  it('beforeDelete throwing refuses and deletes nothing: the app message reaches the person', async () => {
    const response = await refused(new ConvexError({ message: 'Transfer your team first.' }))
    expect(response).toMatchObject({ status: 403, body: { message: 'Transfer your team first.' } })
  })

  it('beforeDelete throwing refuses and deletes nothing: any other error is a generic refusal', async () => {
    const response = await refused(new Error('private database detail'))
    expect(response).toMatchObject({ status: 403, body: { message: 'AUTH_USER_DELETE_REFUSED' } })
    expect(JSON.stringify(response.body)).not.toContain('private database detail')
  })

  // Catches: an old stolen session deleting the account without the password.
  it('refuses a stale session and deletes nothing', async () => {
    const { request, signIn, users, ageSession } = setup({ deleteUser: { enabled: true } })
    await signIn()
    await ageSession(2 * 24 * 60 * 60 * 1000)
    const response = await request('POST', '/delete-user', {})
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(await users()).toHaveLength(1)
    // The password stands in for freshness.
    expect((await request('POST', '/delete-user', { password: credentials.password })).status).toBe(
      200,
    )
    expect(await users()).toHaveLength(0)
  })

  // Catches: the email option not being used for confirmation, or deleting before the link is opened.
  it('with an email sender, mails a delete-account link and deletes when it is opened', async () => {
    const { request, signIn, users, ageSession, mails } = setup(
      { deleteUser: { enabled: true } },
      'mail',
    )
    await signIn()
    await ageSession(2 * 24 * 60 * 60 * 1000)
    expect(await request('POST', '/delete-user', {})).toMatchObject({
      status: 200,
      body: { message: 'Verification email sent' },
    })
    expect(await users()).toHaveLength(1)
    const message = mails[0]!
    expect(message).toMatchObject({ type: 'delete-account', to: credentials.email })
    if (message.type !== 'delete-account') throw new Error('Expected a delete-account email')
    const link = new URL(message.url)
    expect(link.pathname).toBe('/api/auth/delete-user/callback')
    expect((await request('GET', `/delete-user/callback?token=${message.token}`)).status).toBe(200)
    expect(await users()).toHaveLength(0)
  })

  // Catches: a delete path that skips the app's onDelete trigger, so the user projection and its
  // erasure never run for a user an admin or a cleanup job removes. The direct component call
  // is the path the docs warn against.
  it.each([
    ['deleteThroughComponent', 'mutation', false],
    ['deleteThroughHelper', 'mutation', true],
    ['deleteThroughHelperAction', 'action', true],
  ] as const)(
    '%s deletes the user and runs the onDelete trigger: %s %s',
    async (path, kind, runs) => {
      const { request, signIn, users, sessions, accounts, test } = setup({}, undefined, deletePaths)
      await signIn()
      expect((await request('GET', '/get-session')).status).toBe(200)
      const id = (await users())[0]!.id as string
      if (kind === 'action') {
        await test.action(makeFunctionReference<'action', { id: string }>(`auth:${path}`), { id })
      } else {
        await test.mutation(makeFunctionReference<'mutation', { id: string }>(`auth:${path}`), {
          id,
        })
      }
      expect(await users()).toEqual([])
      expect((await sessions()).page).toEqual([])
      expect((await accounts()).page).toEqual([])
      expect(await test.query(deletedAuthUsers, {})).toEqual(runs ? [id] : [])
    },
  )

  it('treats a user that does not exist as deleted', async () => {
    const { signIn, users, test } = setup({}, undefined, deletePaths)
    await signIn()
    const before = await users()
    await test.mutation(
      makeFunctionReference<'mutation', { id: string }>('auth:deleteThroughHelper'),
      {
        id: 'no-such-user',
      },
    )
    expect(await users()).toEqual(before)
    expect(await test.query(deletedAuthUsers, {})).toEqual([])
  })

  it('refuses to delete from a query', async () => {
    const { signIn, users, test } = setup({}, undefined, deletePaths)
    await signIn()
    const id = (await users())[0]!.id as string
    await expect(
      test.query(makeFunctionReference<'query', { id: string }>('auth:deleteFromQuery'), { id }),
    ).rejects.toThrow(/AUTH_DELETE_USER_REQUIRES_WRITABLE_CONTEXT/)
    expect(await users()).toHaveLength(1)
  })
})
