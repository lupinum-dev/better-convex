/**
 * The one owner of the upstream `oidc` tokens: refresh with a lease across
 * isolates, a compare-and-swap write, and `invalid_grant` as the only signal
 * that the IdP grant ended. `auth.getOidcAccessToken(ctx)` and the liveness
 * check at Convex token mint both use it.
 */
import type { OAuth2Tokens } from 'better-auth/oauth2'

import { logOidcFailure } from './diagnostics'
import { OidcError, oidcDeadline } from './oidc-fetch'
import {
  OIDC_ID_TOKEN_MAX_AGE_SECONDS,
  type OidcClient,
  type OidcTokenResult,
} from './oidc-metadata'

const OIDC_REFRESH_LEASE_SECONDS = 30
/** One margin for the helper and the mint. */
const OIDC_REFRESH_MARGIN_MS = 60_000
const OIDC_BUSY_POLL_INTERVAL_MS = 500
/** A waiter outlasts the lease holder's own deadline by this much. */
const BUSY_WAIT_GRACE_MS = 1_000

export interface OidcAccountRecord {
  readonly id: string
  readonly userId: string
  /** The account key `<issuer tag>:<sub>`. */
  readonly accountId: string
  /** Sealed. */
  readonly accessToken: string | null
  /** Sealed. */
  readonly refreshToken: string | null
  /** Plaintext; the adapter seals it at rest. */
  readonly idToken: string | null
  readonly accessTokenExpiresAt: Date | null
}

export type OidcTokenPatch = {
  readonly accessToken: string
  readonly accessTokenExpiresAt: Date | null
  readonly refreshToken: string | null
  readonly refreshTokenExpiresAt: Date | null
  readonly idToken: string | null
}

/** The atomic rate-limit mutation (F18); with `max: 1` it is a lease for `window` seconds. */
export type ConsumeRateLimit = (
  key: string,
  rule: { window: number; max: number },
) => Promise<{ readonly allowed: boolean }>

export interface OidcUpstreamDeps {
  readonly client: OidcClient
  readonly consume: ConsumeRateLimit
  /** The user's `oidc` account, `null` without one, `'conflict'` with more than one. */
  readonly findAccountForUser: (userId: string) => Promise<OidcAccountRecord | null | 'conflict'>
  /** Writes `patch` only while the stored refresh token still equals `expectedRefreshToken`. */
  readonly swapTokens: (
    id: string,
    expectedRefreshToken: string,
    patch: OidcTokenPatch,
  ) => Promise<boolean>
  /** Ends the user's sessions, then clears the stored IdP tokens. */
  readonly endGrant: (userId: string) => Promise<void>
  readonly seal: (token: string) => Promise<string>
  /** Throws for a value without the `$ba$` envelope. */
  readonly open: (sealed: string) => Promise<string>
}

export type OidcRefreshOutcome =
  | { readonly kind: 'fresh'; readonly accessToken: string; readonly expiresAt: number }
  | { readonly kind: 'busy' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'no-account' }
  | { readonly kind: 'no-refresh-token' }

export interface OidcUpstream {
  /** The helper path: waits while another call holds the refresh lease. */
  accessToken(userId: string): Promise<OidcRefreshOutcome>
  /** The mint path: `false` only when the IdP refused the grant now. Never waits, fails open. */
  isGrantLive(userId: string): Promise<boolean>
}

type FreshAccount = OidcAccountRecord & {
  readonly accessToken: string
  readonly accessTokenExpiresAt: Date
}
type RefreshableAccount = OidcAccountRecord & { readonly refreshToken: string }

const UNAVAILABLE = { kind: 'unavailable' } as const

function isFresh(account: OidcAccountRecord): account is FreshAccount {
  return (
    account.accessToken !== null &&
    account.accessTokenExpiresAt !== null &&
    account.accessTokenExpiresAt.getTime() - Date.now() > OIDC_REFRESH_MARGIN_MS
  )
}

function unavailable(detail: string): OidcRefreshOutcome {
  logOidcFailure(`AUTH_OIDC_REFRESH_FAILED:${detail}`)
  return UNAVAILABLE
}

function transportFailure(error: unknown): string {
  return error instanceof OidcError && error.detail !== undefined ? error.detail : 'network'
}

function conflict(): OidcRefreshOutcome {
  logOidcFailure('AUTH_OIDC_ACCOUNT_CONFLICT')
  return UNAVAILABLE
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createOidcUpstream(deps: OidcUpstreamDeps): OidcUpstream {
  const client = deps.client

  async function freshOutcome(account: FreshAccount): Promise<OidcRefreshOutcome> {
    let accessToken: string
    try {
      accessToken = await deps.open(account.accessToken)
    } catch {
      return unavailable('decrypt')
    }
    return { kind: 'fresh', accessToken, expiresAt: account.accessTokenExpiresAt.getTime() }
  }

  // Only an unchanged refresh token proves that the IdP refused *our* grant.
  async function endGrantIfUnchanged(current: RefreshableAccount): Promise<OidcRefreshOutcome> {
    const latest = await deps.findAccountForUser(current.userId)
    // prettier-ignore
    if (latest === 'conflict' || latest?.refreshToken !== current.refreshToken) return { kind: 'busy' }
    await deps.endGrant(current.userId)
    logOidcFailure('AUTH_OIDC_GRANT_ENDED')
    return { kind: 'ended' }
  }

  async function store(
    current: RefreshableAccount,
    tokens: OAuth2Tokens & { readonly accessToken: string },
    idToken: string | null,
  ): Promise<OidcRefreshOutcome> {
    const accessTokenExpiresAt = tokens.accessTokenExpiresAt ?? null
    const patch: OidcTokenPatch = {
      accessToken: await deps.seal(tokens.accessToken),
      accessTokenExpiresAt,
      refreshToken: tokens.refreshToken
        ? await deps.seal(tokens.refreshToken)
        : current.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      idToken,
    }
    // A sign-in that stored newer tokens since the lease keeps them; ours are dropped.
    if (!(await deps.swapTokens(current.id, current.refreshToken, patch))) return { kind: 'busy' }
    // The token response always carries an expiry (S1 applies a default lifetime).
    const expiresAt = accessTokenExpiresAt?.getTime() ?? Date.now()
    return { kind: 'fresh', accessToken: tokens.accessToken, expiresAt }
  }

  async function refresh(
    account: OidcAccountRecord,
    deadline: number,
  ): Promise<OidcRefreshOutcome> {
    if (isFresh(account)) return await freshOutcome(account)
    if (account.refreshToken === null) return { kind: 'no-refresh-token' }

    // Atomic across isolates. The lease outlasts the deadline, so only one call per account
    // reaches the IdP.
    const lease = await deps.consume(`oidc-refresh-lease:${account.id}`, {
      window: OIDC_REFRESH_LEASE_SECONDS,
      max: 1,
    })
    if (!lease.allowed) return { kind: 'busy' }

    // Re-read under the lease: another caller may have refreshed before we took it.
    const reread = await deps.findAccountForUser(account.userId)
    if (reread === null) return { kind: 'no-account' }
    if (reread === 'conflict') return conflict()
    if (isFresh(reread)) return await freshOutcome(reread)
    if (reread.refreshToken === null) return { kind: 'no-refresh-token' }
    const current: RefreshableAccount = { ...reread, refreshToken: reread.refreshToken }

    let refreshToken: string
    try {
      refreshToken = await deps.open(current.refreshToken)
    } catch {
      return unavailable('decrypt')
    }

    let result: OidcTokenResult
    try {
      result = await client.requestTokens({ type: 'refresh_token', refreshToken }, deadline)
    } catch (error) {
      // An outage never ends sessions. A timeout after the IdP rotated the token loses the
      // grant; the next refresh then gets `invalid_grant` (documented). The `:timeout` line
      // before `AUTH_OIDC_GRANT_ENDED` is the operator's evidence for that.
      return unavailable(transportFailure(error))
    }
    if (!result.ok && result.error === 'invalid_grant') return await endGrantIfUnchanged(current)
    if (
      !result.ok &&
      (result.error === 'invalid_client' || result.error === 'unauthorized_client')
    ) {
      logOidcFailure('AUTH_OIDC_CLIENT_REJECTED')
      return UNAVAILABLE
    }
    if (!result.ok) return unavailable(`status_${result.status}`)

    const tokens = result.tokens
    const accessToken = tokens.accessToken
    if (!accessToken) return unavailable('response')
    if (tokens.idToken === undefined)
      return await store(current, { ...tokens, accessToken }, current.idToken)

    // The kept ID token is later sent as `id_token_hint`, so it is verified first.
    // The nonce is not checked on refresh.
    const verified = await client.verifyJwt(
      tokens.idToken,
      {
        typ: 'id_token',
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
        maxTokenAgeSeconds: OIDC_ID_TOKEN_MAX_AGE_SECONDS,
      },
      deadline,
    )
    // prettier-ignore
    if (verified.ok && (await client.accountKey(String(verified.payload.sub))) !== current.accountId) return unavailable('subject')
    if (!verified.ok) logOidcFailure(`AUTH_OIDC_ID_TOKEN_INVALID:${verified.reason}`)
    const idToken = verified.ok ? tokens.idToken : current.idToken
    return await store(current, { ...tokens, accessToken }, idToken)
  }

  return {
    async accessToken(userId) {
      const account = await deps.findAccountForUser(userId)
      if (account === null) return { kind: 'no-account' }
      if (account === 'conflict') return conflict()
      const deadline = oidcDeadline()
      const outcome = await refresh(account, deadline)
      if (outcome.kind !== 'busy') return outcome
      // The lease holder's deadline is at most ours, so this outlasts it.
      while (Date.now() < deadline + BUSY_WAIT_GRACE_MS) {
        await wait(OIDC_BUSY_POLL_INTERVAL_MS)
        const latest = await deps.findAccountForUser(userId)
        if (latest === null) return { kind: 'no-account' }
        if (latest === 'conflict') return conflict()
        if (isFresh(latest)) return await freshOutcome(latest)
        // `refresh` saw a refresh token before it returned busy, so the holder ended the grant.
        if (latest.refreshToken === null) return { kind: 'ended' }
      }
      return unavailable('busy')
    },

    async isGrantLive(userId) {
      try {
        const account = await deps.findAccountForUser(userId)
        if (account === null) return true
        if (account === 'conflict') {
          conflict()
          return true
        }
        if (account.refreshToken === null || isFresh(account)) return true
        return (await refresh(account, oidcDeadline())).kind !== 'ended'
      } catch (error) {
        // Fail open: an IdP or store failure must not sign anyone out.
        logOidcFailure('AUTH_OIDC_REFRESH_FAILED:liveness', { cause: error })
        return true
      }
    },
  }
}
