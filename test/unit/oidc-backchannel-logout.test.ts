import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  handleOidcBackchannelLogout,
  type OidcBackchannelDeps,
} from '../../src/runtime/convex-auth/oidc-backchannel-logout'
import { getOidcClient } from '../../src/runtime/convex-auth/oidc-metadata'
import { resolveOidcConfig } from '../../src/runtime/convex-auth/oidc-options'
import { createFakeIdp, type FakeIdp } from '../helpers/fake-oidc-idp'

const URL_ = 'https://convex.example.test/api/auth/oidc/backchannel-logout'
const FORM = 'application/x-www-form-urlencoded'
const now = () => Math.floor(Date.now() / 1000)

interface Harness {
  readonly deps: OidcBackchannelDeps
  readonly consumed: Array<{ key: string; rule: { window: number; max: number } }>
  readonly lookedUp: string[]
  readonly ended: string[]
}

/**
 * `consume` answers from a script (default: allowed); `findUserIdBySubject`
 * knows `user-1` → `u1`; `endGrant` records the user or throws `endGrantError`.
 */
function harness(
  idp: FakeIdp,
  options: { decisions?: boolean[]; endGrantError?: Error; endGrantFailures?: number } = {},
): Harness {
  const decisions = [...(options.decisions ?? [])]
  const counts = new Map<string, number>()
  let failures = options.endGrantFailures ?? 0
  const consumed: Harness['consumed'] = []
  const lookedUp: string[] = []
  const ended: string[] = []
  const deps: OidcBackchannelDeps = {
    client: getOidcClient(
      resolveOidcConfig({
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
      }),
    ),
    consume: async (key, rule) => {
      consumed.push({ key, rule })
      const scripted = decisions.shift()
      if (scripted !== undefined) return { allowed: scripted, retryAfter: null }
      // Like the rate-limit table within one window: `max` slots per key.
      const count = counts.get(key) ?? 0
      if (count >= rule.max) return { allowed: false, retryAfter: 1 }
      counts.set(key, count + 1)
      return { allowed: true, retryAfter: null }
    },
    findUserIdBySubject: async (sub) => {
      lookedUp.push(sub)
      return sub === 'user-1' ? 'u1' : null
    },
    endGrant: async (userId) => {
      if (options.endGrantError) throw options.endGrantError
      if (failures > 0) {
        failures -= 1
        throw new Error('backend down')
      }
      ended.push(userId)
    },
  }
  return { deps, consumed, lookedUp, ended }
}

function post(body: string, contentType = FORM): Request {
  return new Request(URL_, { method: 'POST', headers: { 'content-type': contentType }, body })
}

function form(token: string): string {
  return new URLSearchParams({ logout_token: token }).toString()
}

/** The codes `logOidcFailure` wrote, in order. */
function loggedCodes(spy: MockInstance<typeof console.error>): string[] {
  return spy.mock.calls
    .filter((call) => call[0] === '[better-convex] AUTH_OIDC_FAILURE')
    .map((call) => (call[1] as { code: string }).code)
}

let restore: Array<() => void> = []
let errors: MockInstance<typeof console.error>

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const undo of restore.reverse()) undo()
  restore = []
  vi.restoreAllMocks()
})

describe('OIDC back-channel logout', () => {
  let idp: FakeIdp

  beforeEach(async () => {
    idp = await createFakeIdp()
    restore.push(idp.install())
  })

  it('ends the grant of the user found by sub', async () => {
    const h = harness(idp)
    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken({ jti: 'jti-1', sid: 'idp-session-1' }))),
      h.deps,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const rule = { window: 1800, max: 3 }
    expect(h.consumed).toEqual(Array(3).fill({ key: 'oidc-logout-jti:jti-1', rule }))
    expect(h.lookedUp).toEqual(['user-1'])
    expect(h.ended).toEqual(['u1'])
  })

  it('answers 200 and ends nothing for an unknown sub', async () => {
    const h = harness(idp)
    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken({ sub: 'someone-else' }))),
      h.deps,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(h.lookedUp).toEqual(['someone-else'])
    expect(h.ended).toEqual([])
  })

  it('accepts a logout token with two audiences and no azp', async () => {
    const h = harness(idp)
    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken({ aud: [idp.clientId, 'account'] }))),
      h.deps,
    )

    expect(response.status).toBe(200)
    expect(h.ended).toEqual(['u1'])
  })

  const rejected: Array<{
    name: string
    request: (idp: FakeIdp) => Promise<Request>
    decisions?: boolean[]
    log: string
    consumes: number
  }> = [
    {
      name: 'a logout token without the back-channel event',
      request: async (idp) =>
        post(form(await idp.signLogoutToken({ events: { 'urn:example:other-event': {} } }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:events',
      consumes: 0,
    },
    {
      // The event member must be a JSON object, not only present.
      name: 'a logout token whose back-channel event is not an object',
      request: async (idp) =>
        post(
          form(
            await idp.signLogoutToken({
              events: { 'http://schemas.openid.net/event/backchannel-logout': true },
            }),
          ),
        ),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:events',
      consumes: 0,
    },
    {
      name: 'a logout token with a non-string sid',
      request: async (idp) => post(form(await idp.signLogoutToken({ sid: 42 }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:sid',
      consumes: 0,
    },
    {
      name: 'a logout token with a jti longer than 256 characters',
      request: async (idp) => post(form(await idp.signLogoutToken({ jti: 'x'.repeat(257) }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:jti',
      consumes: 0,
    },
    {
      name: 'a logout token with a nonce',
      request: async (idp) => post(form(await idp.signLogoutToken({ nonce: 'n-1' }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:nonce',
      consumes: 0,
    },
    {
      name: 'a sid-only logout token',
      request: async (idp) =>
        post(form(await idp.signLogoutToken({ sub: undefined, sid: 'idp-session-1' }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:sub',
      consumes: 0,
    },
    {
      // jose allows maxTokenAge plus the 60 s clock tolerance, so 400 s is past both.
      name: 'a logout token issued more than 5 minutes ago',
      request: async (idp) => post(form(await idp.signLogoutToken({ iat: now() - 400 }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:too_old',
      consumes: 0,
    },
    {
      name: 'a logout token issued more than 60 s in the future',
      request: async (idp) => post(form(await idp.signLogoutToken({ iat: now() + 120 }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:not_yet_valid',
      consumes: 0,
    },
    {
      name: 'a logout token for another audience',
      request: async (idp) => post(form(await idp.signLogoutToken({ aud: 'another-client' }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:audience',
      consumes: 0,
    },
    {
      name: 'a logout token from another issuer',
      request: async (idp) =>
        post(form(await idp.signLogoutToken({ iss: 'https://evil.example.test/realms/acme' }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:issuer',
      consumes: 0,
    },
    {
      name: 'typ at+jwt',
      request: async (idp) => post(form(await idp.signLogoutToken({}, { typ: 'at+jwt' }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:typ',
      consumes: 0,
    },
    {
      // A captured ID token (Keycloak's carry a jti) has no logout event.
      name: 'an id_token',
      request: async (idp) => post(form(await idp.signIdToken({ jti: 'id-token-jti' }))),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:claim_missing',
      consumes: 0,
    },
    {
      name: 'two logout_token parameters',
      request: async (idp) => {
        const body = new URLSearchParams()
        body.append('logout_token', await idp.signLogoutToken())
        body.append('logout_token', await idp.signLogoutToken())
        return post(body.toString())
      },
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:missing',
      consumes: 0,
    },
    {
      name: 'a JSON body',
      request: async (idp) =>
        post(JSON.stringify({ logout_token: await idp.signLogoutToken() }), 'application/json'),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:content_type',
      consumes: 0,
    },
    {
      // A valid token with padding: only the body limit refuses it.
      name: 'a body over 16 KiB',
      request: async (idp) =>
        post(`${form(await idp.signLogoutToken())}&padding=${'a'.repeat(16_384)}`),
      log: 'AUTH_OIDC_LOGOUT_TOKEN_INVALID:body',
      consumes: 0,
    },
    {
      name: 'a replayed jti',
      request: async (idp) => post(form(await idp.signLogoutToken())),
      decisions: [false],
      log: 'AUTH_OIDC_LOGOUT_REPLAYED',
      consumes: 1,
    },
  ]

  for (const testCase of rejected) {
    it(`rejects ${testCase.name}`, async () => {
      const h = harness(idp, { decisions: testCase.decisions })
      const response = await handleOidcBackchannelLogout(await testCase.request(idp), h.deps)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"error":"invalid_request"}')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(loggedCodes(errors)).toEqual([testCase.log])
      expect(h.consumed).toHaveLength(testCase.consumes)
      expect(h.lookedUp).toEqual([])
      expect(h.ended).toEqual([])
    })
  }

  it('rejects an HS256 logout token without fetching keys', async () => {
    const h = harness(idp)
    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken({}, { alg: 'HS256' }))),
      h.deps,
    )

    expect(response.status).toBe(400)
    expect(loggedCodes(errors)).toEqual(['AUTH_OIDC_LOGOUT_TOKEN_INVALID:algorithm'])
    expect(idp.requests).toEqual([])
    expect(h.ended).toEqual([])
  })

  it('answers 405 for GET', async () => {
    const h = harness(idp)
    const response = await handleOidcBackchannelLogout(new Request(URL_), h.deps)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('')
    expect(idp.requests).toEqual([])
  })

  it('answers 503 when the keys cannot be fetched', async () => {
    idp.respond.jwks = () => new Response('{}', { status: 500 })
    const h = harness(idp)
    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken())),
      h.deps,
    )

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"error":"temporarily_unavailable"}')
    expect(response.headers.get('retry-after')).toBe('30')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(loggedCodes(errors)).toEqual(['AUTH_OIDC_JWKS_FAILED'])
    expect(h.consumed).toEqual([])
    expect(h.ended).toEqual([])
  })

  // Catches: an unknown kid inside the cooldown reported as an IdP outage.
  it('answers 400 for an unknown kid inside the key cooldown, without a keys-failing alert', async () => {
    const h = harness(idp)
    const first = await handleOidcBackchannelLogout(post(form(await idp.signLogoutToken())), h.deps)
    expect(first.status).toBe(200)
    await idp.rotateKey()

    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken())),
      h.deps,
    )

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"invalid_request"}')
    expect(loggedCodes(errors)).toEqual(['AUTH_OIDC_KEY_UNKNOWN'])
    expect(h.ended).toEqual(['u1'])
    expect(h.consumed).toHaveLength(3)
  })

  // Catches: the jti recorded before endGrant, so the IdP's retry after a 500 is refused.
  it('ends the grant on the IdP retry after endGrant failed, and refuses a replay after that', async () => {
    const h = harness(idp, { endGrantFailures: 1 })
    const request = async () =>
      handleOidcBackchannelLogout(
        post(form(await idp.signLogoutToken({ jti: 'jti-retry' }))),
        h.deps,
      )

    expect((await request()).status).toBe(500)
    expect(h.ended).toEqual([])
    expect((await request()).status).toBe(200)
    expect(h.ended).toEqual(['u1'])

    const replay = await request()
    expect(replay.status).toBe(400)
    expect(h.ended).toEqual(['u1'])
  })

  it('answers 500 when ending the grant fails', async () => {
    const h = harness(idp, { endGrantError: new Error('backend down') })
    const response = await handleOidcBackchannelLogout(
      post(form(await idp.signLogoutToken())),
      h.deps,
    )

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(loggedCodes(errors)).toEqual(['AUTH_OIDC_LOGOUT_REVOKE_FAILED'])
  })
})
