import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { oidcDeadline } from '../../src/runtime/convex-auth/oidc-fetch'
import { getOidcClient } from '../../src/runtime/convex-auth/oidc-metadata'
import { resolveOidcConfig } from '../../src/runtime/convex-auth/oidc-options'
import {
  createOidcUpstream,
  type OidcAccountRecord,
  type OidcUpstreamDeps,
} from '../../src/runtime/convex-auth/oidc-upstream'
import { createFakeIdp } from '../helpers/fake-oidc-idp'

const NOW = Date.parse('2026-10-21T10:00:00.000Z')
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = 'w1TpKUdYE9hUAcNSeeSRFioHDxfUxuHho_JHAfZ_vDM'
const REDIRECT_URI = 'https://app.example.test/api/auth/oauth2/callback/oidc'
const LEASE_KEY = 'oidc-refresh-lease:account-1'

type StoredAccount = OidcAccountRecord & { refreshTokenExpiresAt?: Date | null }

let restoreFetch: (() => void) | undefined

beforeEach(() => {
  // setImmediate stays real, so `realTurns` lets crypto and streams finish between time steps.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
})

afterEach(() => {
  restoreFetch?.()
  restoreFetch = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The upstream with recording stubs: a lease store, an account store with a real compare-and-swap. */
async function setup() {
  const idp = await createFakeIdp()
  restoreFetch = idp.install()
  const client = getOidcClient(
    resolveOidcConfig({
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
    }),
  )
  const accounts = new Map<string, StoredAccount>()
  const leases = new Map<string, number>()
  const consumed: Array<{ key: string; rule: { window: number; max: number } }> = []
  const ended: string[] = []
  const deps: OidcUpstreamDeps = {
    client,
    async consume(key, rule) {
      consumed.push({ key, rule })
      const until = leases.get(key)
      if (until !== undefined && Date.now() < until) return { allowed: false }
      leases.set(key, Date.now() + rule.window * 1000)
      return { allowed: true }
    },
    async findAccountForUser(userId) {
      const found = [...accounts.values()].filter((account) => account.userId === userId)
      if (found.length > 1) return 'conflict'
      return found[0] ? { ...found[0] } : null
    },
    async swapTokens(id, expectedRefreshToken, patch) {
      const account = accounts.get(id)
      if (!account || account.refreshToken !== expectedRefreshToken) return false
      accounts.set(id, { ...account, ...patch })
      return true
    },
    async endGrant(userId) {
      ended.push(userId)
      for (const account of accounts.values()) {
        if (account.userId !== userId) continue
        accounts.set(account.id, {
          ...account,
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: null,
        })
      }
    },
    seal: async (token) => `$ba$${token}`,
    open: async (sealed) => {
      if (!sealed.startsWith('$ba$')) throw new Error('not sealed')
      return sealed.slice(4)
    },
  }

  /** A real code exchange at the fake IdP, stored as an expired account so the next call refreshes. */
  async function signIn(overrides: Partial<StoredAccount> = {}): Promise<StoredAccount> {
    const code = idp.issueCode({
      nonce: 'n',
      codeChallenge: CHALLENGE,
      redirectURI: REDIRECT_URI,
      claims: { sub: 'user-1' },
    })
    const result = await client.requestTokens(
      { type: 'authorization_code', code, codeVerifier: VERIFIER, redirectURI: REDIRECT_URI },
      oidcDeadline(),
    )
    if (!result.ok) throw new Error('sign-in failed')
    const account: StoredAccount = {
      id: 'account-1',
      userId: 'user-1',
      accountId: await client.accountKey('user-1'),
      accessToken: `$ba$${result.tokens.accessToken}`,
      refreshToken: `$ba$${result.tokens.refreshToken}`,
      idToken: 'stored-id-token',
      accessTokenExpiresAt: new Date(NOW - 1_000),
      ...overrides,
    }
    accounts.set(account.id, account)
    idp.requests.length = 0
    return account
  }

  return {
    idp,
    client,
    accounts,
    leases,
    consumed,
    ended,
    signIn,
    deps,
    upstream: createOidcUpstream(deps),
    tokenRequests: () => idp.requests.filter((request) => request.url.endsWith('/token')).length,
  }
}

function captureLogCodes(): () => string[] {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => log.mock.calls.map((call) => (call[1] as { code: string }).code)
}

async function realTurns(count = 20): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false, promise }
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  return state
}

/** Moves fake time in 100 ms steps until the call settles, letting real async work finish first. */
async function run<T>(promise: Promise<T>, limitMs = 15_000): Promise<T> {
  const call = track(promise)
  for (let elapsed = 0; elapsed <= limitMs; elapsed += 100) {
    await realTurns()
    if (call.settled) return await promise
    await vi.advanceTimersByTimeAsync(100)
  }
  throw new Error(`did not settle within ${limitMs} ms`)
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !condition(); turn += 1) await realTurns(5)
  if (!condition()) throw new Error('condition not reached')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function tamperSignature(jwt: string): string {
  const [header, payload, signature] = jwt.split('.') as [string, string, string]
  const changed = signature[10] === 'A' ? 'B' : 'A'
  return `${header}.${payload}.${signature.slice(0, 10)}${changed}${signature.slice(11)}`
}

describe('OIDC upstream tokens', () => {
  it('returns a fresh token without calling the IdP', async () => {
    const { upstream, accounts, idp, consumed } = await setup()
    accounts.set('account-1', {
      id: 'account-1',
      userId: 'user-1',
      accountId: 'tag:user-1',
      accessToken: '$ba$access-1',
      refreshToken: '$ba$refresh-1',
      idToken: null,
      accessTokenExpiresAt: new Date('2026-10-21T10:05:00.000Z'),
    })

    expect(await upstream.accessToken('user-1')).toEqual({
      kind: 'fresh',
      accessToken: 'access-1',
      expiresAt: 1_792_577_100_000,
    })
    expect(idp.requests).toEqual([])
    expect(consumed).toEqual([])
  })

  it('refreshes once and stores the new tokens sealed', async () => {
    const { upstream, accounts, consumed, signIn, tokenRequests } = await setup()
    const before = await signIn()

    const outcome = await upstream.accessToken('user-1')

    expect(outcome).toMatchObject({ kind: 'fresh', expiresAt: 1_792_577_100_000 })
    if (outcome.kind !== 'fresh') throw new Error('not fresh')
    const stored = accounts.get('account-1')
    expect(stored?.accessToken).toBe(`$ba$${outcome.accessToken}`)
    expect(stored?.accessToken).not.toBe(before.accessToken)
    expect(stored?.refreshToken).toMatch(/^\$ba\$[0-9a-f]{32}$/u)
    expect(stored?.refreshToken).not.toBe(before.refreshToken)
    expect(stored?.idToken?.split('.')).toHaveLength(3)
    expect(stored?.accessTokenExpiresAt).toEqual(new Date('2026-10-21T10:05:00.000Z'))
    expect(tokenRequests()).toBe(1)
    expect(consumed).toEqual([{ key: LEASE_KEY, rule: { window: 30, max: 1 } }])
  })

  it('two concurrent refreshes call the token endpoint once', async () => {
    const { upstream, signIn, tokenRequests, ended } = await setup()
    await signIn()

    const outcomes = await run(
      Promise.all([upstream.accessToken('user-1'), upstream.accessToken('user-1')]),
    )

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['fresh', 'fresh'])
    expect(tokenRequests()).toBe(1)
    expect(ended).toEqual([])
  })

  it("the waiting caller gets the winner's token", async () => {
    const { upstream, accounts, signIn, tokenRequests } = await setup()
    await signIn()

    const winner = track(upstream.accessToken('user-1'))
    await waitFor(() => tokenRequests() === 1)
    const waiter = upstream.accessToken('user-1')
    const [won, waited] = await run(Promise.all([winner.promise, waiter]))

    expect(won.kind).toBe('fresh')
    expect(waited).toEqual(won)
    if (waited.kind !== 'fresh') throw new Error('not fresh')
    expect(accounts.get('account-1')?.accessToken).toBe(`$ba$${waited.accessToken}`)
  })

  it('invalid_grant ends the grant', async () => {
    const { upstream, accounts, ended } = await setup()
    const logCodes = captureLogCodes()
    for (const userId of ['user-1', 'user-2']) {
      accounts.set(`account-${userId}`, {
        id: `account-${userId}`,
        userId,
        accountId: `tag:${userId}`,
        accessToken: null,
        refreshToken: '$ba$revoked-refresh-token',
        idToken: 'stored-id-token',
        accessTokenExpiresAt: null,
      })
    }

    expect(await upstream.accessToken('user-1')).toEqual({ kind: 'ended' })
    expect(await upstream.checkGrant('user-2')).toBe('ended')

    expect(ended).toEqual(['user-1', 'user-2'])
    expect(logCodes()).toEqual(['AUTH_OIDC_GRANT_ENDED', 'AUTH_OIDC_GRANT_ENDED'])
  })

  it('does not end the grant when another refresh wrote new tokens', async () => {
    const { upstream, accounts, idp, ended } = await setup()
    const account: StoredAccount = {
      id: 'account-1',
      userId: 'user-1',
      accountId: 'tag:user-1',
      accessToken: null,
      refreshToken: '$ba$old-refresh-token',
      idToken: null,
      accessTokenExpiresAt: null,
    }
    accounts.set('account-1', account)
    idp.respond.token = () => {
      // Another isolate refreshed (or a sign-in ran) while this request was in flight.
      accounts.set('account-1', {
        ...account,
        accessToken: '$ba$other-access-token',
        refreshToken: '$ba$other-refresh-token',
        accessTokenExpiresAt: new Date('2026-10-21T10:05:00.000Z'),
      })
      return json({ error: 'invalid_grant' }, 400)
    }

    expect(await run(upstream.accessToken('user-1'))).toEqual({
      kind: 'fresh',
      accessToken: 'other-access-token',
      expiresAt: 1_792_577_100_000,
    })
    expect(ended).toEqual([])
    expect(accounts.get('account-1')?.refreshToken).toBe('$ba$other-refresh-token')
  })

  it('does not overwrite tokens that a sign-in stored during the refresh', async () => {
    const { upstream, accounts, idp, ended, signIn } = await setup()
    const account = await signIn()
    const signedIn: StoredAccount = {
      ...account,
      accessToken: '$ba$sign-in-access-token',
      refreshToken: '$ba$sign-in-refresh-token',
      idToken: 'sign-in-id-token',
      accessTokenExpiresAt: new Date('2026-10-21T11:00:00.000Z'),
    }
    idp.respond.token = async (request) => {
      delete idp.respond.token
      accounts.set('account-1', signedIn)
      return await fetch(request)
    }

    expect(await run(upstream.accessToken('user-1'))).toEqual({
      kind: 'fresh',
      accessToken: 'sign-in-access-token',
      expiresAt: 1_792_580_400_000,
    })
    expect(accounts.get('account-1')).toEqual(signedIn)
    expect(ended).toEqual([])
  })

  for (const testCase of [
    {
      name: 'timeout',
      answer: () => new Promise<Response>(() => {}),
      log: 'AUTH_OIDC_REFRESH_FAILED:timeout',
    },
    {
      name: '500',
      answer: () => json({ error: 'server_error' }, 500),
      log: 'AUTH_OIDC_REFRESH_FAILED:status_500',
    },
    {
      name: 'network',
      answer: (): Response => {
        throw new TypeError('fetch failed')
      },
      log: 'AUTH_OIDC_REFRESH_FAILED:network',
    },
  ]) {
    it(`IdP outage keeps the sessions ${testCase.name}`, async () => {
      const { upstream, accounts, idp, ended, signIn } = await setup()
      const before = await signIn()
      const logCodes = captureLogCodes()
      idp.respond.token = testCase.answer

      expect(await run(upstream.checkGrant('user-1'))).toBe('live')

      expect(ended).toEqual([])
      expect(accounts.get('account-1')).toEqual(before)
      expect(logCodes()).toEqual([testCase.log])
    })
  }

  it('a timeout after the IdP rotated the token loses the grant, and the next refresh ends it', async () => {
    const { upstream, accounts, idp, ended, signIn } = await setup()
    const before = await signIn()
    captureLogCodes()
    let rotated = false
    idp.respond.token = async (request) => {
      delete idp.respond.token
      const answer = await fetch(request)
      rotated = true
      await new Promise((resolve) => setTimeout(resolve, 11_000))
      return answer
    }

    const first = track(upstream.accessToken('user-1'))
    await waitFor(() => rotated)
    expect(await run(first.promise)).toEqual({ kind: 'unavailable' })
    expect(accounts.get('account-1')).toEqual(before)
    expect(ended).toEqual([])

    await vi.advanceTimersByTimeAsync(30_000)
    expect(await run(upstream.accessToken('user-1'))).toEqual({ kind: 'ended' })
    expect(ended).toEqual(['user-1'])
  })

  // Catches: a waiter that keeps polling after the lease holder ended the grant and then reports
  // an outage ("try again later") in place of "sign in again".
  it('the waiting caller learns that the lease holder ended the grant', async () => {
    const { upstream, idp, ended, signIn, tokenRequests } = await setup()
    await signIn()
    captureLogCodes()
    idp.respond.token = async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      return json({ error: 'invalid_grant' }, 400)
    }

    const holder = track(upstream.accessToken('user-1'))
    await waitFor(() => tokenRequests() === 1)
    const waiter = upstream.accessToken('user-1')
    const [held, waited] = await run(Promise.all([holder.promise, waiter]))

    expect(held).toEqual({ kind: 'ended' })
    expect(waited).toEqual({ kind: 'ended' })
    expect(ended).toEqual(['user-1'])
  })

  // Catches: a refresh that drops the stored refresh token or ID token when an IdP that does not
  // rotate omits them, which turns the next use into "sign in again" and loses `id_token_hint`.
  it('keeps the stored refresh token and ID token when the response omits them', async () => {
    const { upstream, accounts, idp, signIn } = await setup()
    const before = await signIn()
    idp.respond.token = () =>
      json({ access_token: 'non-rotated-access', token_type: 'Bearer', expires_in: 300 })

    expect(await upstream.accessToken('user-1')).toEqual({
      kind: 'fresh',
      accessToken: 'non-rotated-access',
      expiresAt: 1_792_577_100_000,
    })
    expect(accounts.get('account-1')).toMatchObject({
      accessToken: '$ba$non-rotated-access',
      refreshToken: before.refreshToken,
      idToken: 'stored-id-token',
    })
  })

  it('invalid_client keeps the sessions and logs AUTH_OIDC_CLIENT_REJECTED', async () => {
    const { upstream, accounts, idp, ended, signIn } = await setup()
    const before = await signIn()
    const logCodes = captureLogCodes()
    idp.respond.token = () => json({ error: 'invalid_client' }, 401)

    expect(await upstream.accessToken('user-1')).toEqual({ kind: 'unavailable' })
    expect(await upstream.checkGrant('user-1')).toBe('live')

    expect(ended).toEqual([])
    expect(accounts.get('account-1')).toEqual(before)
    expect(logCodes()).toEqual(['AUTH_OIDC_CLIENT_REJECTED'])
  })

  it.each([
    { expiredFor: 59 * 60_000, state: 'live', logs: [] },
    { expiredFor: 61 * 60_000, state: 'unchecked', logs: ['AUTH_OIDC_GRANT_UNCHECKED'] },
  ])(
    'checkGrant trusts an unanswered IdP only for an hour after expiry ($state)',
    async ({ expiredFor, state, logs }) => {
      const { upstream, accounts, idp, ended, signIn } = await setup()
      const before = await signIn({ accessTokenExpiresAt: new Date(NOW - expiredFor) })
      const logCodes = captureLogCodes()
      idp.respond.token = () => json({ error: 'invalid_client' }, 401)

      expect(await upstream.checkGrant('user-1')).toBe(state)

      // Refused, not ended: the sessions and tokens stay for when the IdP answers again.
      expect(ended).toEqual([])
      expect(accounts.get('account-1')).toEqual(before)
      expect(logCodes()).toEqual(['AUTH_OIDC_CLIENT_REJECTED', ...logs])
    },
  )

  it('stores a long-lived access token with at most 15 minutes left, so the IdP is asked again', async () => {
    const { upstream, accounts, idp, signIn } = await setup()
    await signIn()
    idp.respond.token = () =>
      json({
        access_token: 'eight-hours',
        refresh_token: 'rotated',
        token_type: 'Bearer',
        expires_in: 8 * 3600,
      })

    expect(await upstream.accessToken('user-1')).toMatchObject({
      kind: 'fresh',
      expiresAt: NOW + 15 * 60_000,
    })
    expect(accounts.get('account-1')?.accessTokenExpiresAt).toEqual(new Date(NOW + 15 * 60_000))
  })

  it('ends the grant when a refreshed id_token names another subject', async () => {
    const { upstream, accounts, client, ended, signIn } = await setup()
    // The fake IdP answers the refresh with an ID token for `user-1`.
    await signIn({ accountId: await client.accountKey('user-2') })
    const logCodes = captureLogCodes()

    expect(await upstream.accessToken('user-1')).toEqual({ kind: 'ended' })
    // Neither the other subject's tokens are stored nor the old ones kept.
    expect(accounts.get('account-1')).toMatchObject({ accessToken: null, refreshToken: null })
    expect(ended).toEqual(['user-1'])
    expect(logCodes()).toEqual(['AUTH_OIDC_REFRESH_FAILED:subject', 'AUTH_OIDC_GRANT_ENDED'])
  })

  it('drops a refreshed id_token with a bad signature and keeps the old one', async () => {
    const { upstream, accounts, idp, signIn } = await setup()
    await signIn()
    const logCodes = captureLogCodes()
    idp.respond.token = async (request) => {
      delete idp.respond.token
      const body = (await (await fetch(request)).json()) as Record<string, string>
      return json({ ...body, id_token: tamperSignature(body.id_token ?? '') })
    }

    const outcome = await upstream.accessToken('user-1')

    expect(outcome.kind).toBe('fresh')
    if (outcome.kind !== 'fresh') throw new Error('not fresh')
    expect(accounts.get('account-1')?.accessToken).toBe(`$ba$${outcome.accessToken}`)
    expect(accounts.get('account-1')?.idToken).toBe('stored-id-token')
    expect(logCodes()).toEqual(['AUTH_OIDC_ID_TOKEN_INVALID:signature'])
  })

  it('ends the grant instead of sending a refresh token stored without encryption', async () => {
    const { upstream, idp, ended, signIn } = await setup()
    await signIn({ refreshToken: 'plaintext-refresh-token' })
    const logCodes = captureLogCodes()

    // An unreadable grant never works again: asking later cannot help, so the user signs in again.
    expect(await upstream.accessToken('user-1')).toEqual({ kind: 'ended' })
    expect(idp.requests).toEqual([])
    expect(ended).toEqual(['user-1'])
    expect(logCodes()).toEqual(['AUTH_OIDC_REFRESH_FAILED:decrypt', 'AUTH_OIDC_GRANT_ENDED'])
  })

  it('past the grace time, a parallel check waits for the lease holder instead of trusting it', async () => {
    const { upstream, leases, accounts, signIn } = await setup()
    const account = await signIn({ accessTokenExpiresAt: new Date(NOW - 61 * 60_000) })
    leases.set(LEASE_KEY, NOW + 30_000)

    const check = track(upstream.checkGrant('user-1'))
    // The lease holder's IdP answer: the grant ended.
    accounts.set(account.id, { ...account, accessToken: null, refreshToken: null })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await check.promise).toBe('ended')
  })

  it('fails closed with two oidc accounts', async () => {
    const { upstream, accounts, idp, consumed, signIn } = await setup()
    const first = await signIn()
    accounts.set('account-2', { ...first, id: 'account-2', accountId: 'tag:user-1-other' })
    const logCodes = captureLogCodes()

    expect(await upstream.accessToken('user-1')).toEqual({ kind: 'unavailable' })
    expect(idp.requests).toEqual([])
    expect(consumed).toEqual([])
    expect(logCodes()).toEqual(['AUTH_OIDC_ACCOUNT_CONFLICT'])
  })

  it('checkGrant skips the IdP while the token has more than 60 s left', async () => {
    const { upstream, signIn, tokenRequests } = await setup()
    await signIn({ accessTokenExpiresAt: new Date('2026-10-21T10:01:01.000Z') })

    expect(await upstream.checkGrant('user-1')).toBe('live')
    expect(tokenRequests()).toBe(0)

    vi.setSystemTime(NOW + 2_000)
    expect(await upstream.checkGrant('user-1')).toBe('live')
    expect(tokenRequests()).toBe(1)
  })

  it('checkGrant does not wait for a busy lease', async () => {
    const { upstream, leases, idp, signIn } = await setup()
    await signIn()
    leases.set(LEASE_KEY, NOW + 30_000)

    // No fake time passes: a caller that polls for the lease holder never settles here.
    const live = track(upstream.checkGrant('user-1'))
    await realTurns()

    expect(live.settled).toBe(true)
    expect(await live.promise).toBe('live')
    expect(idp.requests).toEqual([])
  })

  it('checkGrant fails open when the lease store throws', async () => {
    const { deps, signIn } = await setup()
    await signIn()
    const logCodes = captureLogCodes()
    const upstream = createOidcUpstream({
      ...deps,
      consume: async () => {
        throw new Error('OCC conflict')
      },
    })

    expect(await upstream.checkGrant('user-1')).toBe('live')
    expect(logCodes()).toEqual(['AUTH_OIDC_REFRESH_FAILED:liveness'])
  })

  it("the waiting caller waits past the lease holder's deadline", async () => {
    const { upstream, idp, signIn, tokenRequests } = await setup()
    await signIn()
    // The holder's IdP answers at 9.9 s, just inside the holder's 10 s deadline.
    idp.respond.token = async (request) => {
      delete idp.respond.token
      const body = (await (await fetch(request)).json()) as Record<string, unknown>
      await new Promise((resolve) => setTimeout(resolve, NOW + 9_900 - Date.now()))
      return json({ ...body, id_token: undefined })
    }

    const holder = track(upstream.accessToken('user-1'))
    await waitFor(() => tokenRequests() === 2)
    const waiter = upstream.accessToken('user-1')
    const [held, waited] = await run(Promise.all([holder.promise, waiter]))

    expect(held.kind).toBe('fresh')
    expect(waited).toEqual(held)
  })
})
