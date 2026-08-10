import { inspect } from 'node:util'

import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createBetterAuthBrowserAdapter } from '../../src/runtime/auth/better-auth-browser-adapter'

interface SessionState {
  data?: {
    session?: { token?: unknown }
    user?: { id?: unknown }
  } | null
  isPending?: boolean
  isRefetching?: boolean
  error?: unknown
  refetch?: () => Promise<void>
}

function jwt(sub: string, expiresInSeconds = 3_600) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub, exp: Math.floor(Date.now() / 1_000) + expiresInSeconds })}.signature`
}

function source(
  initial: SessionState,
  responses: Array<{ data?: { token: string | null } | null; error?: unknown }>,
) {
  const refetch = vi.fn(async () => {})
  const session = ref<SessionState>({ ...initial, refetch })
  const token = vi.fn(async () => responses.shift() ?? { data: null, error: null })
  return {
    session,
    refetch,
    token,
    client: {
      useSession: () => session,
      convex: { token },
    },
  }
}

describe('Better Auth browser adapter', () => {
  it('keeps matching SSR identity provenance through initial provider settlement', () => {
    const fixture = source({ isPending: true, data: null, error: null }, [])
    const adapter = createBetterAuthBrowserAdapter(fixture.client, undefined, {
      initialIdentityKey: 'alice',
    })

    expect(adapter.snapshot()).toMatchObject({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 0,
    })

    fixture.session.value = {
      isPending: false,
      data: {
        session: { token: 'session-a' },
        user: { id: 'alice' },
      },
      error: null,
    }
    expect(adapter.snapshot()).toMatchObject({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 0,
    })
    adapter.dispose()
  })

  it('retires mismatched SSR identity provenance before provider confirmation', () => {
    const fixture = source({ isPending: true, data: null, error: null }, [])
    const adapter = createBetterAuthBrowserAdapter(fixture.client, undefined, {
      initialIdentityKey: 'alice',
    })

    fixture.session.value = {
      isPending: false,
      data: {
        session: { token: 'session-b' },
        user: { id: 'bob' },
      },
      error: null,
    }
    expect(adapter.snapshot()).toMatchObject({
      status: 'authenticated',
      identityKey: 'bob',
      sessionGeneration: 1,
    })
    adapter.dispose()
  })

  it('uses the same session parser for identity and reconciliation', () => {
    const stableData = {
      session: { token: 'session-a' },
      user: { id: 'alice' },
    }
    const fixture = source({ isPending: true, data: null, error: null }, [])
    const sessionChanged = vi.fn()
    const adapter = createBetterAuthBrowserAdapter(fixture.client, {
      authenticated: vi.fn(),
      anonymous: vi.fn(),
      sessionChanged,
    })

    expect(sessionChanged).not.toHaveBeenCalled()
    fixture.session.value = { isPending: false, data: stableData, error: null }
    expect(sessionChanged.mock.calls).toEqual([['session-a', null, 1]])
    expect(adapter.snapshot()).toMatchObject({
      status: 'authenticated',
      identityKey: 'alice',
    })

    fixture.session.value = { ...fixture.session.value }
    expect(sessionChanged).toHaveBeenCalledTimes(1)

    fixture.session.value = {
      ...fixture.session.value,
      data: {
        session: stableData.session,
        user: { ...stableData.user },
      },
    }
    expect(sessionChanged.mock.calls).toEqual([
      ['session-a', null, 1],
      ['session-a', null, 1],
    ])

    fixture.session.value = { isPending: false, data: null, error: null }
    expect(sessionChanged).toHaveBeenLastCalledWith(null, null, 2)
    adapter.dispose()
  })

  it('derives only a stable key and generation from public session state', () => {
    const fixture = source(
      {
        isPending: true,
        data: null,
        error: null,
      },
      [],
    )
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    expect(adapter.snapshot()).toMatchObject({
      status: 'loading',
      sessionGeneration: 0,
    })

    fixture.session.value = {
      isPending: false,
      data: {
        session: { token: 'better-auth-session-secret' },
        user: { id: 'alice' },
      },
      error: null,
    }
    expect(adapter.snapshot()).toMatchObject({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: 1,
    })
    expect(JSON.stringify(adapter.snapshot())).not.toContain('session-secret')

    // A JSON-equal session observation is not a new credential lifecycle.
    fixture.session.value = { ...fixture.session.value }
    expect(adapter.snapshot().sessionGeneration).toBe(1)

    fixture.session.value = {
      isPending: false,
      data: {
        session: { token: 'better-auth-replacement-session-secret' },
        user: { id: 'alice' },
      },
      error: null,
    }
    expect(adapter.snapshot().sessionGeneration).toBe(2)

    fixture.session.value = { isPending: false, data: null, error: null }
    expect(adapter.snapshot()).toMatchObject({
      status: 'anonymous',
      identityKey: null,
      sessionGeneration: 3,
    })
    adapter.dispose()
  })

  it('assigns a new revision when a failed-closed session later recovers', () => {
    const data = {
      session: { token: 'session-a' },
      user: { id: 'alice' },
    }
    const fixture = source({ isPending: false, data, error: null }, [])
    const sessionChanged = vi.fn()
    const adapter = createBetterAuthBrowserAdapter(fixture.client, {
      authenticated: vi.fn(),
      anonymous: vi.fn(),
      sessionChanged,
    })
    expect(sessionChanged).toHaveBeenLastCalledWith('session-a', null, 1)

    adapter.failClosed('static failure')
    expect(sessionChanged).toHaveBeenLastCalledWith(
      null,
      'Authentication is temporarily unavailable',
      2,
    )

    fixture.session.value = { isPending: false, data: { ...data }, error: null }
    expect(sessionChanged).toHaveBeenLastCalledWith('session-a', null, 3)
    adapter.dispose()
  })

  it('returns only a matching short-lived Convex identity token', async () => {
    const aliceToken = jwt('alice')
    const fixture = source(
      {
        isPending: false,
        data: { session: { token: 'session-a' }, user: { id: 'alice' } },
        error: null,
      },
      [{ data: { token: aliceToken }, error: null }],
    )
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    await expect(adapter.fetchToken({ forceRefreshToken: false })).resolves.toBe(aliceToken)
    expect(JSON.stringify(adapter.snapshot())).not.toContain(aliceToken)
    adapter.dispose()
  })

  it('rejects a token whose subject disagrees with the observed session user', async () => {
    const fixture = source(
      {
        isPending: false,
        data: { session: { token: 'session-a' }, user: { id: 'alice' } },
        error: null,
      },
      [{ data: { token: jwt('bob') }, error: null }],
    )
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    await expect(adapter.fetchToken({ forceRefreshToken: false })).resolves.toBeNull()
    adapter.dispose()
  })

  it('fails malformed/error session state closed and disposes observation once', () => {
    const fixture = source(
      {
        isPending: false,
        data: { session: { token: 'session-secret' }, user: {} },
        error: null,
      },
      [],
    )
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    const listener = vi.fn()
    adapter.subscribe(listener)
    expect(adapter.snapshot()).toMatchObject({
      status: 'error',
      identityKey: null,
    })
    expect(JSON.stringify(adapter.snapshot())).not.toContain('session-secret')

    adapter.dispose()
    adapter.dispose()
    fixture.session.value = { isPending: false, data: null, error: null }
    expect(listener).not.toHaveBeenCalled()
  })

  it('never forwards a raw Better Auth error through session reconciliation', () => {
    const sentinels = {
      message: 'SESSION_MESSAGE_SENTINEL_723e6a',
      cause: 'SESSION_CAUSE_SENTINEL_a52b11',
      stack: 'SESSION_STACK_SENTINEL_0c418f',
    }
    const error = new Error(sentinels.message, {
      cause: new Error(sentinels.cause),
    })
    error.stack = sentinels.stack
    const fixture = source({ isPending: false, data: null, error }, [])
    const sessionChanged = vi.fn()
    const adapter = createBetterAuthBrowserAdapter(fixture.client, {
      authenticated: vi.fn(),
      anonymous: vi.fn(),
      sessionChanged,
    })

    expect(sessionChanged).toHaveBeenCalledWith(
      null,
      'Authentication is temporarily unavailable',
      1,
    )
    const rendered = inspect(sessionChanged.mock.calls, { depth: null })
    for (const sentinel of Object.values(sentinels)) expect(rendered).not.toContain(sentinel)
    adapter.dispose()
  })

  it('retains an established session on a transient refetch failure but retires it on 401', async () => {
    const data = {
      session: { token: 'session-a' },
      user: { id: 'alice' },
    }
    const fixture = source({ isPending: false, data, error: null }, [])
    const listener = vi.fn()
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    adapter.subscribe(listener)
    const generation = adapter.snapshot().sessionGeneration

    fixture.session.value = {
      isPending: false,
      data,
      error: { status: 503, message: 'raw-upstream-sentinel' },
      refetch: fixture.refetch,
    }
    expect(adapter.snapshot()).toMatchObject({
      status: 'authenticated',
      identityKey: 'alice',
      sessionGeneration: generation,
      error: null,
    })
    expect(listener).not.toHaveBeenCalled()

    await expect(adapter.refreshSession()).rejects.toThrow(
      'Authentication is temporarily unavailable',
    )
    expect(fixture.refetch).toHaveBeenCalledOnce()

    fixture.refetch.mockRejectedValueOnce(new Error('raw-refetch-rejection-sentinel'))
    await expect(adapter.refreshSession()).rejects.toThrow(
      'Authentication is temporarily unavailable',
    )

    fixture.session.value = {
      isPending: false,
      data,
      error: { status: 401, message: 'raw-unauthorized-sentinel' },
      refetch: fixture.refetch,
    }
    expect(adapter.snapshot()).toMatchObject({
      status: 'error',
      identityKey: null,
      sessionGeneration: generation + 1,
    })
    expect(JSON.stringify(adapter.snapshot())).not.toContain('raw-unauthorized-sentinel')
    adapter.dispose()
  })

  it('waits for the canonical session ref to settle after refetch resolves', async () => {
    const data = {
      session: { token: 'session-a' },
      user: { id: 'alice' },
    }
    const fixture = source({ isPending: false, data, error: null }, [])
    fixture.refetch.mockImplementationOnce(async () => {
      fixture.session.value = {
        isPending: true,
        data,
        error: null,
        refetch: fixture.refetch,
      }
    })
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    const finished = vi.fn()
    const refresh = adapter.refreshSession().then(finished)

    await vi.waitFor(() => expect(adapter.snapshot().status).toBe('loading'))
    expect(finished).not.toHaveBeenCalled()

    fixture.session.value = {
      isPending: false,
      data: null,
      error: null,
      refetch: fixture.refetch,
    }
    await expect(refresh).resolves.toBeUndefined()
    expect(finished).toHaveBeenCalledOnce()
    expect(adapter.snapshot().status).toBe('anonymous')
    adapter.dispose()
  })

  it('waits for the winning refetch when a concurrent provider refresh aborts its request', async () => {
    const data = {
      session: { token: 'session-a' },
      user: { id: 'alice' },
    }
    const fixture = source({ isPending: false, data, error: null }, [])
    fixture.refetch.mockImplementationOnce(async () => {
      fixture.session.value = {
        isPending: false,
        isRefetching: true,
        data,
        error: null,
        refetch: fixture.refetch,
      }
    })
    const adapter = createBetterAuthBrowserAdapter(fixture.client)
    const finished = vi.fn()
    const refresh = adapter.refreshSession().then(finished)

    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()

    fixture.session.value = {
      isPending: false,
      isRefetching: false,
      data: null,
      error: null,
      refetch: fixture.refetch,
    }
    await expect(refresh).resolves.toBeUndefined()
    expect(finished).toHaveBeenCalledOnce()
    expect(adapter.snapshot().status).toBe('anonymous')
    adapter.dispose()
  })

  it('bounds a provider session ref that never settles', async () => {
    vi.useFakeTimers()
    try {
      const data = {
        session: { token: 'session-a' },
        user: { id: 'alice' },
      }
      const fixture = source({ isPending: false, data, error: null }, [])
      fixture.refetch.mockImplementationOnce(async () => {
        fixture.session.value = {
          isPending: true,
          data,
          error: null,
          refetch: fixture.refetch,
        }
      })
      const adapter = createBetterAuthBrowserAdapter(fixture.client)
      const refresh = expect(adapter.refreshSession()).rejects.toThrow(
        'Authentication is temporarily unavailable',
      )

      await vi.advanceTimersByTimeAsync(5_000)
      await refresh
      adapter.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
