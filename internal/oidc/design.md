# OIDC sign-in through the company identity provider: design

Status: build spec for branch `feat/oidc-sign-in`, revision 2. Revision 2 applies the security and
API reviews; the table "Addressed review findings" at the end gives the decision for each finding.
Decisions in `plan.md` are fixed. This document adds the exact shapes. Better Auth (BA) and
`@better-auth/core` are pinned at 1.7.7.

Path shorthands used below:

- `BA` = `node_modules/better-auth/dist`
- `CORE` = `node_modules/@better-auth/core/dist`
- `JOSE` = `node_modules/.pnpm/jose@6.2.3/node_modules/jose/dist/webapi`
- `cba` = `src/runtime/convex-auth/create-better-convex-auth.ts`
- `cac` = `src/runtime/convex-auth/create-auth-component.ts`

## 0. Verified facts this design depends on

Each line was read in the pinned sources for this design.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                              | Where                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| F1  | Core `socialProviders` options only build BA's built-in providers by key. A custom `oidc` key throws.                                                                                                                                                                                                                                                             | `BA/context/create-context.mjs:103`                                                                               |
| F2  | A plugin `init` can replace `context.socialProviders`. The result is merged with `Object.assign`.                                                                                                                                                                                                                                                                 | `BA/context/helpers.mjs:30`                                                                                       |
| F3  | Sign-out builds a `Map` over `ctx.context.socialProviders`, so each entry must be an object, not a thunk.                                                                                                                                                                                                                                                         | `BA/api/routes/sign-out.mjs:59-73`                                                                                |
| F4  | The callback compares `iss` with `provider.issuer` only when `iss` is present. A missing `iss` passes.                                                                                                                                                                                                                                                            | `BA/api/routes/callback.mjs:95-101`                                                                               |
| F5  | With `requiresIdTokenNonce`, BA generates a 32-character nonce, stores it in state, refuses a state without it, and passes it to `getUserInfo` as `expectedIdTokenNonce`.                                                                                                                                                                                         | `BA/oauth2/state.mjs:14-16`, `BA/api/routes/callback.mjs:102-104`, `:122`                                         |
| F6  | State lives 600 s. The PKCE verifier is 128 random characters.                                                                                                                                                                                                                                                                                                    | `BA/oauth2/state.mjs:20`, `:31`                                                                                   |
| F7  | `POST /sign-in/social` and `POST /link-social` accept a client-supplied `idToken`. They are refused only when the provider has no `idToken` config and no `verifyIdToken`, or sets `options.disableIdTokenSignIn`.                                                                                                                                                | `BA/api/routes/sign-in.mjs:155-160`, `BA/api/routes/account.mjs:162-167`, `CORE/oauth2/verify-id-token.mjs:22-26` |
| F8  | The client controls `scopes`, `loginHint` and `additionalParams`. BA passes them to `createAuthorizationURL`.                                                                                                                                                                                                                                                     | `BA/api/routes/sign-in.mjs:231-233`, `BA/api/routes/account.mjs:250-252`                                          |
| F9  | The callback reads `disableSignUp` from `provider.options.disableSignUp` and `overrideUserInfo` from `provider.options.overrideUserInfoOnSignIn`.                                                                                                                                                                                                                 | `BA/api/routes/callback.mjs:181-182`                                                                              |
| F10 | `disableImplicitLinking: true` refuses every implicit link, even with a verified email or a trusted provider.                                                                                                                                                                                                                                                     | `BA/oauth2/link-account.mjs:139`                                                                                  |
| F11 | An explicit link (`/link-social`) requires a trusted provider or a verified upstream email.                                                                                                                                                                                                                                                                       | `BA/oauth2/link-account.mjs:43-47`                                                                                |
| F12 | `getValidAccessToken` refreshes through `provider.refreshAccessToken` and writes the account with no lock. On any error it throws `FAILED_TO_GET_ACCESS_TOKEN`, so the IdP error is lost.                                                                                                                                                                         | `BA/api/routes/account.mjs:368-404`                                                                               |
| F13 | The BA router runs, in order: `disabledPaths`, the rate limit, then each plugin `onRequest`. A plugin `onRequest` can answer with its own `Response`.                                                                                                                                                                                                             | `BA/api/index.mjs:168-178`                                                                                        |
| F14 | The origin check is router middleware for endpoints (`/**`). An `onRequest` answer never reaches it.                                                                                                                                                                                                                                                              | `BA/api/index.mjs:160`                                                                                            |
| F15 | `context.internalAdapter` is built once before plugin `init` with only the user's `databaseHooks` (`BA/context/create-context.mjs:196-203`), then **replaced** after all plugin inits with every plugin's `databaseHooks` and the merged options (`BA/context/helpers.mjs:47-53`). Code in `init` must read `ctx.internalAdapter` when it runs, never capture it. | as given                                                                                                          |
| F16 | `deleteUserSessions(userId)` sends the selector that our adapter turns into a security-generation bump (no row delete).                                                                                                                                                                                                                                           | `BA/db/internal-adapter.mjs:503-522`, `src/runtime/convex-auth/session-generation.ts:208-231`                     |
| F17 | `findAccountByKey({providerId, accountId})` uses the `providerId_accountId` index and throws on duplicates.                                                                                                                                                                                                                                                       | `BA/db/internal-adapter.mjs:671-683`, `src/runtime/convex-auth/component/schema.ts:56`                            |
| F18 | `consumeRateLimit` is one atomic mutation. With `max: 1` it admits a key once per `window`.                                                                                                                                                                                                                                                                       | `src/runtime/convex-auth/adapter/define-functions.ts:908-998`                                                     |
| F19 | The stored `idToken` is encrypted by our adapter (`createAccountIdTokenProtector`). Access and refresh tokens are encrypted by BA (`encryptOAuthTokens: true`).                                                                                                                                                                                                   | `src/runtime/convex-auth/adapter/create-adapter.ts:91-153`, `cba:1307`                                            |
| F20 | `@better-auth/core/oauth2` (re-exported by `better-auth/oauth2`) exports `createAuthorizationURL`, `authorizationCodeRequest`, `refreshAccessTokenRequest`, `getOAuth2Tokens`, `applyDefaultAccessTokenExpiry`. It does not export `fetchRefusingRedirects`. `better-auth/oauth2` also exports `setTokenUtil` and `decryptOAuthToken`.                            | `CORE/oauth2/index.mjs:1-16`, `BA/oauth2/index.mjs:4-5`                                                           |
| F21 | Core `createAuthorizationURL` sets S256 PKCE when a verifier is given, sets `nonce`, and uses `options.redirectURI` before the per-request `redirectURI`.                                                                                                                                                                                                         | `CORE/oauth2/create-authorization-url.mjs:20-59`                                                                  |
| F22 | `verifyProviderIdToken` trusts the token's own `alg` when no allow-list is set, skips the nonce check when the nonce is empty, and returns only a boolean. We do not use it.                                                                                                                                                                                      | `CORE/oauth2/verify-id-token.mjs:38-60`                                                                           |
| F23 | `OAuth2UserInfo.id` is typed `never`. The account key comes only from `accountSubject`.                                                                                                                                                                                                                                                                           | `CORE/oauth2/oauth-provider.d.mts:68`, `BA/oauth2/account-key.mjs:12-26`                                          |
| F24 | The `/convex/token` handler re-reads the session and the user before it signs. It has no extension point today.                                                                                                                                                                                                                                                   | `src/runtime/convex-auth/plugin.ts:913-1019`                                                                      |
| F25 | A direct call to the Convex site URL without proxy headers uses the request IP from Convex metadata.                                                                                                                                                                                                                                                              | `cac:123-142`                                                                                                     |
| F26 | `jose` 6.2.3 is installed. Our package lists it only as a devDependency. `@better-auth/core` lists it as a peer (`^6.1.0`).                                                                                                                                                                                                                                       | `package.json:172`, `node_modules/@better-auth/core/package.json:180`                                             |
| F27 | `better-call` knows `SERVICE_UNAVAILABLE` (503).                                                                                                                                                                                                                                                                                                                  | `node_modules/.pnpm/better-call@1.4.0_zod@4.6.5/node_modules/better-call/dist/error.mjs:88`                       |
| F28 | Convex allows `fetch` only in actions and HTTP actions. The factory builds BA in queries and mutations too (`getAuth`, `cac:322-347`).                                                                                                                                                                                                                            | Convex documentation; the backend enforces it, not `node_modules/convex`                                          |
| F29 | BA awaits `accountSubject`, and the callback passes `getUserInfo`'s `data` as `profile`.                                                                                                                                                                                                                                                                          | `BA/oauth2/account-key.mjs:14-20`, `BA/api/routes/callback.mjs:134-137`                                           |
| F30 | jose reports an `iat` older than `maxTokenAge` as `JWTExpired` with `claim === 'iat'`, and a future `iat` as `JWTClaimValidationFailed` with `claim === 'iat'`. `jwtVerify` does not try several keys when the key set throws `JWKSMultipleMatchingKeys`.                                                                                                         | `JOSE/lib/jwt_claims_set.js:155`, `:162`, `:165`; `JOSE/jwks/local.js:81`                                         |
| F31 | `decryptOAuthToken` returns a value that does not look encrypted unchanged. BA's envelope prefix is `$ba$`.                                                                                                                                                                                                                                                       | `BA/oauth2/utils.mjs:7-19`, `BA/crypto/index.mjs:14`                                                              |
| F32 | A plugin `init` may return `options.databaseHooks`; they join the rebuilt internal adapter. A `create.before` hook gets the current endpoint context (`path`, `params`) and may throw.                                                                                                                                                                            | `BA/context/helpers.mjs:30-35`, `:47-53`; `BA/db/with-hooks.mjs:7-15`                                             |
| F33 | Linking an account with another `accountId` for the same provider creates a second account row.                                                                                                                                                                                                                                                                   | `BA/oauth2/link-account.mjs:48-68`                                                                                |
| F34 | A new OAuth user is built from `getUserInfo`'s `user` (name, image, and any extra keys of `user` that are input fields), never from `data`.                                                                                                                                                                                                                       | `BA/oauth2/link-account.mjs:262-280`                                                                              |
| F35 | With `NODE_ENV=test`, the origin check is off unless `advanced.disableOriginCheck` is set.                                                                                                                                                                                                                                                                        | `BA/context/create-context.mjs:213`                                                                               |
| F36 | `disableRedirect` is a sign-out body field. With it, sign-out returns the provider URL without a `Location` header.                                                                                                                                                                                                                                               | `BA/api/routes/sign-out.mjs:7`, `:86-90`                                                                          |
| F37 | The adapter's `updateOne` matches every `where` clause and patches in one mutation, and returns `null` when no row matches. That gives a compare-and-swap.                                                                                                                                                                                                        | `src/runtime/convex-auth/adapter/define-functions.ts:675-712`                                                     |
| F38 | The factory already disables the HTTP routes `/get-access-token` and `/refresh-token`. `auth.api` calls do not pass `disabledPaths`.                                                                                                                                                                                                                              | `cba:1334-1337`                                                                                                   |

### One deviation from the plan wording

The plan and the spike say discovery runs "at startup". This design resolves discovery **lazily, on
first use, and caches it per isolate**. Reason (F28): the factory builds Better Auth inside mutations
(`getAuth`). An eager fetch there always fails, and every mutation that uses auth would break. The
plan's intent still holds: the `oidc` provider always exists. Every use of it fails closed with a
named error. Nothing is silently skipped.

## 1. Outcome and non-goals

### Outcome

An app passes one `oidc` option. People then sign in through the company's OIDC identity provider
(IdP). Keycloak is the first target, and any compliant IdP works. The result:

1. Sign-in uses the authorization code flow, with state, PKCE S256, a nonce and a fully verified
   ID token. None of these can be turned off.
2. Users are keyed by `(providerId 'oidc', <issuer tag>:<sub>)`. The issuer tag binds each account
   to the configured issuer (3.4). A new user needs `email_verified: true`. The factory never links
   accounts implicitly, and an `oidc` account is never trusted for linking.
3. **IdP-managed users.** A user who has an `oidc` account gets new sessions only through the IdP.
   Password, email-code and every other door refuse that user (3.8). Disabling the user at the IdP
   therefore locks them out of the app too.
4. Sign-out ends the app session and returns the IdP's end-session URL. The browser then ends the
   IdP session too.
5. **Central logout.** The IdP calls a back-channel logout route. That route ends every app session
   of the user, bumps the user's security generation and clears the stored IdP tokens.
6. **Liveness check.** At the Convex token mint, an expiring IdP access token is refreshed. When the
   IdP refuses the refresh token (grant revoked, user disabled, or, on IdPs that bind refresh tokens
   to the SSO session such as Keycloak, the session ended), the app sessions end. For the bound,
   see 4.6.
7. Server actions get a current IdP access token through `auth.getOidcAccessToken(ctx)`, so they
   can call internal services for the user. Refreshes are serialized, writes are compare-and-swap,
   and an ended grant is detected.

### Non-goals

- The app as an IdP for other apps (OAuth provider outside MCP). This stays `oauth.mcp` only.
- SAML.
- More than one OIDC IdP.
- Token exchange (RFC 8693) and audience narrowing.
- Per-IdP-session logout (`sid`). This needs a session column, which is a schema change.
- Front-channel logout.
- IdP-initiated sign-in.
- Syncing profile changes from the IdP into the user row.
- Mapping IdP roles or groups into Convex (see open question Q1).
- Extra scopes (`oidc.scopes`), client-chosen scopes, `login_hint` or extra authorization
  parameters. Adding an optional `scopes` later is not breaking; add it for a real IdP that needs it.
- `offline_access`. No option can request it.
- HMAC-signed (`HS*`) ID tokens.
- Requiring the RFC 9207 `iss` parameter (3.5).
- A migration helper for a changed issuer (Q6).
- A UI component. Apps call the Better Auth client.

## 2. Public API

### 2.1 Types (in `src/runtime/convex-auth/oidc-options.ts`, re-exported from `index.ts`)

```ts
/** Sign-in through one OpenID Connect identity provider. The provider id is always `oidc`. */
export interface BetterConvexOidcOptions {
  /**
   * The issuer identifier, exactly as the provider publishes it in its discovery document,
   * for example `https://sso.example.com/realms/acme`. https only; http only for
   * localhost, 127.0.0.1 or [::1]. The issuer is part of every user's account key:
   * changing it unlinks every user.
   */
  readonly issuer: string
  /** The confidential client's id at the provider. */
  readonly clientId: string
  /** The confidential client's secret. Read it from an environment variable. */
  readonly clientSecret: string
}

/** What `auth.getOidcAccessToken(ctx)` returns. */
export interface BetterConvexOidcAccessToken {
  readonly accessToken: string
  /** Milliseconds since the epoch. */
  readonly expiresAt: number
}
```

Additions to `CreateBetterConvexAuthOptions<DataModel>` (in `cba`):

```ts
  /**
   * Sign-in through your company's OpenID Connect provider (Keycloak, or any compliant IdP).
   * Pass a function to read environment variables when Convex calls it, not when the module loads.
   * A user who signs in through it, or links it, then signs in only through it.
   */
  readonly oidc?: BetterConvexOidcOptions | (() => BetterConvexOidcOptions)
```

Additions to `BetterConvexAuth<DataModel, AuthInstance>`:

```ts
  /**
   * Action only. A current access token from the `oidc` provider for the calling user, for calls
   * to your own services. The token has more than 60 seconds left; the helper refreshes it
   * otherwise. Never return it to the browser, log it, or pass it to a scheduled function.
   *
   * Throws `ConvexError` with `data.code`:
   * - `UNAUTHENTICATED`: no live session.
   * - `OIDC_ACCOUNT_REQUIRED`: the user has no `oidc` account.
   * - `OIDC_SIGN_IN_REQUIRED`: the IdP grant ended or no refresh token is stored.
   * - `OIDC_UNAVAILABLE`: the IdP did not answer in time, or the stored tokens cannot be used.
   *
   * Throws `TypeError` (a programming error) with message:
   * - `AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION`: called from a query or mutation.
   * - `AUTH_OIDC_NOT_CONFIGURED`: the factory has no `oidc` option.
   */
  readonly getOidcAccessToken: (
    ctx: GenericActionCtx<DataModel>,
  ) => Promise<BetterConvexOidcAccessToken>
```

**Caller-visible codes.** One code per concept, at every surface:

| Code                    | Surface                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_UNAVAILABLE`      | `POST /sign-in/social` and `POST /link-social` (503, `APIError` code and message); `getOidcAccessToken` (`ConvexError`)             |
| `OIDC_SIGN_IN_REQUIRED` | Any session-creating endpoint for an IdP-managed user (403, `APIError` code and message, 3.8); `getOidcAccessToken` (`ConvexError`) |
| `OIDC_ACCOUNT_REQUIRED` | `getOidcAccessToken` (`ConvexError`)                                                                                                |
| `OIDC_ACCOUNT_CONFLICT` | `/callback/oidc` while linking a second `oidc` account (403 inside BA's link flow, 3.8)                                             |
| `OIDC_UNLINK_REFUSED`   | `POST /unlink-account` for the `oidc` account (403, `APIError` code and message, 3.8 rule 7)                                        |

The `AUTH_OIDC_*` codes in 3.3 appear only in server logs.

There are no other new options. Each field has a requirement:

- `issuer`, `clientId` and `clientSecret` are needed for any confidential client.
- The function form is needed because env vars are not set on the first `convex dev` push. This
  is the same reason as for `socialProviders` (`cba:365`, `cba:1188-1191`).

**Rejected options.** Each was rejected with a reason:

- `scopes`: Keycloak puts an audience into every token through a _default_ client scope with an
  audience mapper, so no scope request is needed. Adding an optional field later is not breaking.
- `name`: only for the UI, which the app owns.
- `disableSignUp`: `beforeUserCreate` returning `{ allowed: false }` covers it. See Q2.
- `postLogoutRedirectURI`: the client's `callbackURL` covers it, and BA checks it against the
  trusted origins.
- `pkce`, `nonce`, `requireIdTokenVerification`: always on.
- `discoveryUrl`: always derived from the issuer.
- `trustEmail`: see Q3.
- `mapProfileToUser`: not offered. Profile fields come from the ID token only.
- `previousIssuers`: see Q6.

### 2.2 Constants

Each constant is local to the module that uses it. Only these are exported, because several
modules or tests need them:

```ts
// oidc-options.ts
export const OIDC_PROVIDER_ID = 'oidc'
export const OIDC_BACKCHANNEL_LOGOUT_PATH = '/oidc/backchannel-logout'
// oidc-metadata.ts (used by the provider and the upstream refresh)
export const OIDC_ID_TOKEN_MAX_AGE_SECONDS = 600
```

Module-local values:

| Module                       | Constant                            | Value                                                                               |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `oidc-options.ts`            | `LOOPBACK_HOSTS`                    | `new Set(['localhost', '127.0.0.1', '[::1]'])`                                      |
| `oidc-fetch.ts`              | `OIDC_DEADLINE_MS`                  | `10_000` (one budget per operation, 3.3)                                            |
| `oidc-fetch.ts`              | `OIDC_MAX_RESPONSE_BYTES`           | `65_536`                                                                            |
| `oidc-metadata.ts`           | `OIDC_ALLOWED_ALGORITHMS`           | `['RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512','EdDSA']` |
| `oidc-metadata.ts`           | `OIDC_MAX_JWT_BYTES`                | `16_384`                                                                            |
| `oidc-metadata.ts`           | `OIDC_DISCOVERY_TTL_MS`             | `3_600_000`                                                                         |
| `oidc-metadata.ts`           | `OIDC_JWKS_TTL_MS`                  | `600_000`                                                                           |
| `oidc-metadata.ts`           | `OIDC_JWKS_REFETCH_COOLDOWN_MS`     | `30_000`                                                                            |
| `oidc-metadata.ts`           | `OIDC_FAILURE_BACKOFF_MS`           | `10_000`                                                                            |
| `oidc-metadata.ts`           | `OIDC_CLOCK_TOLERANCE_SECONDS`      | `60`                                                                                |
| `oidc-metadata.ts`           | `OIDC_DEFAULT_ACCESS_TOKEN_SECONDS` | `300`                                                                               |
| `oidc-provider.ts`           | `OIDC_SCOPES`                       | `['openid', 'email', 'profile']`                                                    |
| `oidc-backchannel-logout.ts` | `OIDC_LOGOUT_TOKEN_MAX_AGE_SECONDS` | `300`                                                                               |
| `oidc-backchannel-logout.ts` | `OIDC_LOGOUT_JTI_WINDOW_SECONDS`    | `600`                                                                               |
| `oidc-backchannel-logout.ts` | `OIDC_LOGOUT_MAX_BODY_BYTES`        | `16_384`                                                                            |
| `oidc-backchannel-logout.ts` | `BACKCHANNEL_LOGOUT_EVENT`          | `'http://schemas.openid.net/event/backchannel-logout'`                              |
| `oidc-upstream.ts`           | `OIDC_REFRESH_LEASE_SECONDS`        | `30`                                                                                |
| `oidc-upstream.ts`           | `OIDC_REFRESH_MARGIN_MS`            | `60_000` (one margin for the helper and the mint)                                   |
| `oidc-upstream.ts`           | `OIDC_BUSY_POLL_INTERVAL_MS`        | `500`                                                                               |
| `oidc-plugin.ts`             | `OIDC_BACKCHANNEL_RATE_LIMIT`       | `{ window: 60, max: 600 }`                                                          |

`oidc-fetch.ts` exports `oidcDeadline(): number` (`Date.now() + OIDC_DEADLINE_MS`). Every operation
that touches the IdP takes its deadline from there.

**Minimum access-token lifetime: 2 minutes.** The lease (30 s) plus the margin (60 s) must fit into
one token lifetime, so that a refreshed token is outside the margin for longer than the lease. The
docs state the minimum (8.1). A shorter lifetime makes helper callers wait and then fail with
`OIDC_UNAVAILABLE`; it never ends sessions.

### 2.3 Validation

`resolveOidcConfig(value: unknown): ResolvedOidcConfig` runs in two places:

- For an object value, it runs once in `rejectUnsupportedOptions` (module load).
- For a function value, it runs on every auth construction, on the function's result.

Every message has the prefix `[better-convex] createBetterConvexAuth ` (the `configError` helper,
`cba:531-533`). Messages name the rule, not the value. **No message and no log line ever contains
`clientSecret`.** `issuer` and `clientId` are public, and logs may contain them (3.3).

```ts
interface ResolvedOidcConfig {
  readonly issuer: string // unchanged string
  readonly clientId: string
  readonly clientSecret: string
  readonly loopbackHttp: boolean // issuer is http on a loopback host
}
```

| Rule                                                                                                                                                             | Message after the prefix                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| The value is not a plain object (for the function form: what the function returned)                                                                              | `expected "oidc" to be an object or a function`                                                                                  |
| An unknown key is present                                                                                                                                        | `does not support "oidc.<key>"`                                                                                                  |
| `issuer` is not a string, has leading or trailing space, is longer than 2048, fails `isAllowedIdpUrl(issuer, true)` (3.2), has `search`, or ends with `#` or `?` | `requires "oidc.issuer" to be an https URL without credentials, query or fragment (http only for localhost, 127.0.0.1 or [::1])` |
| `clientId` is not a string of length 1-256 without control characters or surrounding space                                                                       | `requires "oidc.clientId" to be a non-empty string`                                                                              |
| `clientSecret` is not a string of length 1-1024 without control characters                                                                                       | `requires "oidc.clientSecret" to be a non-empty string`                                                                          |

`isAllowedIdpUrl(value: string, allowLoopbackHttp: boolean): boolean` lives in `oidc-options.ts`.
It returns `false` when `new URL` throws. It contains these two lines exactly:

```ts
if (url.username !== '' || url.password !== '' || url.hash !== '') return false
if (url.protocol === 'https:') return true
return allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
```

Cross-option rules in `rejectUnsupportedOptions`. These are static, because the presence of `oidc`
does not depend on the function form.

| Rule                                                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oidc` and an enabled `twoFactor`                                                                               | Extend the existing "doors that skip the second factor" check (`cba:789-798`). Its condition line becomes `if ((record.emailOTP !== undefined && record.emailOTP !== false) \|\| hasSocial \|\| record.oidc !== undefined) {` and its message becomes `does not support "twoFactor" together with "emailOTP", "socialProviders" or "oidc"; those sign-ins skip the second factor, so remove one of them`. Update the existing test that asserts the old message. |
| `socialProviders` (object form) has the key `oidc`. For the function form, the same check runs at construction. | New message: `does not support "socialProviders.oidc"; use the "oidc" option`                                                                                                                                                                                                                                                                                                                                                                                    |
| `account.accountLinking.trustedProviders` names `oidc` (with or without the `oidc` option)                      | New first line in the loop of `resolveTrustedProviders` (`cba:645`): `if (name === OIDC_PROVIDER_ID) throw configError(OIDC_TRUSTED_PROVIDER_MESSAGE)`, with the message `does not support "oidc" in "account.accountLinking.trustedProviders"; linking needs email_verified from the identity provider`. `resolveTrustedProviders` keeps its two parameters.                                                                                                    |

Add `'oidc'` to `REVIEWED_TOP_LEVEL_OPTIONS` (`cba:508-528`).

When the function form fails at construction, the failure runs through
`authConfigFailure('AUTH_CONFIG_OIDC_INVALID', error)`. Add `'AUTH_CONFIG_OIDC_INVALID'` to
`AuthConfigSubCode` (`diagnostics.ts:11-21`). The public error stays `AUTH_CONFIG_INVALID`.

### 2.4 How `oidc` works with the other options

| Option                                                          | Behaviour with `oidc`                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `socialProviders`                                               | Allowed. `oidc` is added before them in `context.socialProviders`. A provider named `oidc` is refused (2.3, 3.9). An IdP-managed user cannot sign in through another social provider (3.8).                                                                                                                                                                                                                 |
| `emailAndPassword`                                              | Allowed, **recommended off**. An IdP-managed user cannot sign in with a password (3.8). A password user with the same email cannot sign in through the IdP until they link (`account_not_linked`, F10). Anyone can register an unverified password user for an employee's address, which blocks that employee's first IdP sign-in until the address owner resets the password and links (documented limit). |
| `emailOTP`                                                      | Allowed. An IdP-managed user cannot sign in with an email code. It is the safe fallback for unlinked users during a cutover (8.1 §9).                                                                                                                                                                                                                                                                       |
| `twoFactor`                                                     | Refused (2.3).                                                                                                                                                                                                                                                                                                                                                                                              |
| `account.accountLinking.trustedProviders`                       | May not name `oidc` (2.3). Linking always needs `email_verified: true` from the IdP (F11). Implicit linking stays off.                                                                                                                                                                                                                                                                                      |
| `siteOrigins`                                                   | Allowed. `redirect_uri` is built per request from the verified public origin (F21: the provider never sets `options.redirectURI`). The IdP must register `https://<each origin>/api/auth/callback/oidc` and each post-logout URI, as exact URIs. Back-channel logout works per user, across all origins.                                                                                                    |
| `session.cookieCache`                                           | BA's own endpoints (`get-session`, `link-social`) can accept a session ended by logout for up to `maxAge` (at most 300 s), as for any other revocation (`cba:184-189`). The Convex token mint and the session checks are not affected.                                                                                                                                                                      |
| `oauth.mcp`                                                     | Allowed. MCP consent needs a signed-in session, and that session may come from `oidc`. A back-channel logout bumps the generation, so the MCP refresh grants of that session die (`oauth-refresh.ts:33-107` admits only live sessions).                                                                                                                                                                     |
| `beforeUserCreate`                                              | Runs for every new OIDC user, with `emailVerified: true`. It is the way to refuse OIDC sign-up. It does not run again at later sign-ins.                                                                                                                                                                                                                                                                    |
| `disableSignUp`                                                 | Not offered for `oidc`. Use `beforeUserCreate`.                                                                                                                                                                                                                                                                                                                                                             |
| `experimental.anonymous`                                        | Allowed. A guest who signs in through the IdP gets the IdP user's session through `/callback/oidc`.                                                                                                                                                                                                                                                                                                         |
| `deleteUser`                                                    | Allowed. It deletes the local user and accounts only. The next IdP sign-in creates a new user.                                                                                                                                                                                                                                                                                                              |
| `organization`, `session` (other fields), `defineSessionClaims` | No interaction.                                                                                                                                                                                                                                                                                                                                                                                             |

### 2.5 Client usage (no new client code)

```ts
const { client } = useConvexAuth()

// Sign in
await client.signIn.social({ provider: 'oidc', callbackURL: '/app', errorCallbackURL: '/sign-in' })

// Sign out of the app and of the identity provider
const { data } = await client.signOut({ disableRedirect: true, callbackURL: '/signed-out' })
if (data?.url)
  window.location.assign(data.url) // the IdP ends its session, then returns to /signed-out
else await navigateTo('/')

// Link the IdP to the signed-in password account
await client.linkSocial({ provider: 'oidc', callbackURL: '/settings' })
```

`disableRedirect` is a body field of sign-out (F36). With it, BA returns the IdP URL and sends no
`Location` header. Without it, BA's default `redirectPlugin` starts the navigation itself, and the
documented `await navigateTo('/')` races it
(`docs/content/docs/3.build/3.authentication/4.sign-in-and-sign-out.md:99-104`). S6b checks only
that the `better-auth/vue` client type accepts the call shape above.

## 3. Provider construction

### 3.1 Owned builder, not genericOAuth

We build the provider ourselves. We use genericOAuth neither as a plugin nor as a library. Reasons:

- genericOAuth fetches discovery in `init` for every request (`BA/plugins/generic-oauth/index.mjs:80-112`).
- It skips the provider silently when the fetch fails (`:91`, and `fetchDiscovery` returning `null`
  at `:24-36`).
- It follows redirects, and it falls back to the userinfo endpoint without nonce binding (`:221`,
  with `fetchUserInfo` decoding without verification at `:38-46`).
- It maps `overrideUserInfo` to `overrideUserInfoOnSignIn` (`:264`).

The provider is a plain `OAuthProvider` object (`CORE/oauth2/oauth-provider.d.mts:115-248`). A
small plugin puts it into `context.socialProviders` during `init` (F2). The provider object is
created synchronously, and none of its fields needs the network. Each method that needs discovery
awaits the per-isolate cache (3.2).

### 3.2 Discovery, JWKS and the client (`oidc-metadata.ts`)

There is one module-level `Map<issuer, IssuerState>`. It is per isolate, best effort, and only
filled in actions and HTTP actions. Tests never reset it: each fake IdP has its own issuer (6.3).

```ts
interface OidcMetadata {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly jwksUri: string
  readonly endSessionEndpoint: string | null
  readonly algorithms: readonly string[] // OIDC_ALLOWED_ALGORITHMS ∩ advertised, in our order
  readonly tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
}
export interface OidcClient {
  readonly config: ResolvedOidcConfig
  metadata(deadline: number): Promise<OidcMetadata>
  verifyJwt(token: string, check: OidcJwtCheck, deadline: number): Promise<OidcJwtResult>
  requestTokens(grant: OidcGrant, deadline: number): Promise<OidcTokenResult>
  /** `<issuer tag>:<sub>`; the account key of this issuer's subject. */
  accountKey(sub: string): Promise<string>
}
export function getOidcClient(config: ResolvedOidcConfig): OidcClient
```

`getOidcClient` returns one client per `(issuer, clientId, clientSecret)` per isolate, so the
caches survive auth constructions. The spike built a new client per construction; the e2e test
"resolves discovery once across sign-ins" catches that.

**Account key.** `accountKey(sub)` returns `` `${tag}:${sub}` ``. `tag` is the first 16 characters of
base64url(SHA-256(UTF-8 `config.issuer`)), computed once per client with `crypto.subtle.digest`.
The line is written exactly as `` return `${await issuerTag}:${sub}` ``. Reason: `sub` is unique only
within one issuer (OIDC Core 5.7). A new issuer with colliding subjects (small numeric ids, for
example) then gets `account_not_linked`, never another user's account. The key is used in three
places: `accountSubject` (3.4), the back-channel lookup (4.2) and the refresh subject check (5.2).

**Failure backoff.** `IssuerState.failure: { until: number; error: OidcError } | null`. A failed
discovery, a failed JWKS fetch, or a transport failure at the token endpoint sets
`failure = { until: Date.now() + OIDC_FAILURE_BACKOFF_MS, error }`. While it holds, `metadata`,
the JWKS loader and `requestTokens` throw the stored error without a fetch. The line is written
exactly as `if (failure && Date.now() < failure.until) throw failure.error`. A success clears it.
This bounds the load on a slow or failing IdP: one attempt per isolate per 10 s, and no unauthenticated
request holds an action for a full deadline more than once per 10 s.

**Discovery.**

- The URL is `issuer + '/.well-known/openid-configuration'`. If the issuer ends with `/`, only
  `.well-known/openid-configuration` is appended.
- The fetch is a GET through `idpFetch` (3.3) with the caller's deadline and a 64 KiB limit.
- A status other than 200, a body that is not JSON, or a body that is not an object fails with
  `AUTH_OIDC_DISCOVERY_FAILED:<detail>`.

Checks, in this order. Any failure throws an `OidcError` with the code shown.

1. `if (document.issuer !== config.issuer) throw new OidcError('AUTH_OIDC_ISSUER_MISMATCH')`, an
   exact string compare. Before the throw, `logOidcFailure` logs `expected` and `received` (3.3).
2. `authorization_endpoint`, `token_endpoint` and `jwks_uri` are strings. Each passes
   `isAllowedIdpUrl(value, config.loopbackHttp)`. Failure: `AUTH_OIDC_DISCOVERY_INVALID:<field>`.
   Same-origin with the issuer is **not** required. Compliant IdPs (for example Google) serve the
   token and JWKS endpoints from other hosts. The operator chose the issuer, so its document is
   trusted as far as the issuer is.
3. `end_session_endpoint`, if present, passes the same URL rule. Otherwise it is `null`.
4. `response_types_supported`, if present, includes `code`. Failure: `AUTH_OIDC_DISCOVERY_INVALID:response_types`.
5. `if (pkceMethods !== undefined && !pkceMethods.includes('S256')) throw invalid('pkce')`.
   When the field is absent, we still send S256.
6. `id_token_signing_alg_values_supported` is a string array (the discovery spec requires it). The
   line is `const algorithms = OIDC_ALLOWED_ALGORITHMS.filter((alg) => advertised.includes(alg))`,
   and the list must not be empty. Failure: `AUTH_OIDC_DISCOVERY_INVALID:algorithms`. `none` and
   `HS*` can never be in the list.
7. `token_endpoint_auth_methods_supported`:
   - absent, or includes `client_secret_basic`: use `client_secret_basic`;
   - otherwise includes `client_secret_post`: use `client_secret_post`;
   - otherwise: `AUTH_OIDC_DISCOVERY_INVALID:token_auth`.

`authorization_response_iss_parameter_supported` is not read (3.5).

**Discovery cache.**

- A successful result is cached for `OIDC_DISCOVERY_TTL_MS` (1 h).
- Fetches are single-flight: concurrent callers share one promise.
- A rejected promise is removed at once:
  `if (discoveryCache.get(config.issuer) === entry) discoveryCache.delete(config.issuer)`. The
  failure backoff then answers for 10 s, and the first use after it retries.
- There is no stale use after the TTL ends.

**JWKS.**

- The fetch is a GET of `jwks_uri` through `idpFetch` (64 KiB).
- The body must be an object whose `keys` is an array of at most 100 entries.
- Only these keys are kept: `kty` is `RSA`, `EC` or `OKP`; `use` is absent or `sig`. An empty
  result fails with `AUTH_OIDC_JWKS_FAILED:empty`.
- The key set is cached per issuer for `OIDC_JWKS_TTL_MS` (10 min), with single-flight fetches.

**Key rotation.** `verifyJwt` resolves keys with `jose.createLocalJWKSet(cached)`.

- When jose throws `JWKSNoMatchingKey`, the code refetches the JWKS once, but only if the last
  fetch is at least `OIDC_JWKS_REFETCH_COOLDOWN_MS` (30 s) old. Then it retries once. The line is
  `if (now - keys.fetchedAt < OIDC_JWKS_REFETCH_COOLDOWN_MS) return null` inside the refetch helper.
- When no refetch was allowed, or the refetch failed, the result is `keys_unavailable`, never
  `signature`. The line is `if (!refreshed) return { ok: false, reason: 'keys_unavailable' }`. A
  valid logout token signed with a just-rotated key then gets 503 and a retry (4.2), and a sign-in
  gets a retriable error.
- This bounds the IdP load from forged tokens with random `kid` values to one JWKS fetch per 30 s.

**`verifyJwt(token, check, deadline)`**:

```ts
type OidcJwtCheck = {
  readonly requiredClaims: readonly string[]
  readonly maxTokenAgeSeconds: number
  readonly typ: 'id_token' | 'logout_token'
}
type OidcJwtFailure =
  | 'too_large'
  | 'malformed'
  | 'typ'
  | 'algorithm'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'too_old'
  | 'not_yet_valid'
  | 'claim_missing'
  | 'azp'
  | 'keys_unavailable'
type OidcJwtResult =
  | { readonly ok: true; readonly payload: JWTPayload; readonly header: JWTHeaderParameters }
  | { readonly ok: false; readonly reason: OidcJwtFailure }
```

Steps. Steps 1-3 run before any fetch.

1. A token longer than `OIDC_MAX_JWT_BYTES` fails with `too_large`. A token without exactly three
   dot-separated parts, or whose protected header does not decode (`decodeProtectedHeader`), fails
   with `malformed`.
2. The `typ` rule. Compare lower-case, with any `application/` prefix removed.
   - `if (check.typ === 'id_token' && typ.endsWith('+jwt')) return { ok: false, reason: 'typ' }`
     (refuses `at+jwt` and `logout+jwt`).
   - `if (check.typ === 'logout_token' && !LOGOUT_TYPES.has(typ)) return { ok: false, reason: 'typ' }`,
     with `LOGOUT_TYPES = new Set(['', 'jwt', 'logout+jwt'])` (`''` is an absent `typ`).
3. `if (!OIDC_ALLOWED_ALGORITHMS.includes(header.alg)) return { ok: false, reason: 'algorithm' }`.
   This refuses `none` and `HS*` before the keys are loaded.
4. Call `jose.jwtVerify(token, keyResolver, options)` with these options:
   - `issuer: client.config.issuer,`
   - `audience: client.config.clientId,`
   - `algorithms: metadata.algorithms,`
   - `clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,`
   - `maxTokenAge: check.maxTokenAgeSeconds,`
   - `requiredClaims: [...check.requiredClaims],`

   Write each option on its own line. The mutant rows in section 7 depend on that. A metadata
   failure here maps to `keys_unavailable`.

5. Map jose errors to reasons (F30). No jose error is rethrown.
   - `JWSSignatureVerificationFailed`, `JWKSMultipleMatchingKeys`: `signature`
   - `JWKSNoMatchingKey`: the key-rotation rule above
   - `JOSEAlgNotAllowed`: `algorithm`
   - `JWTExpired` with `claim === 'iat'`: `too_old`; any other `JWTExpired`: `expired`
   - `JWTClaimValidationFailed`: by `error.claim`: `iss` → `issuer`, `aud` → `audience`,
     `iat` or `nbf` → `not_yet_valid`; `error.reason === 'missing'` → `claim_missing`; otherwise `malformed`
   - `JWSInvalid`, `JWTInvalid`, `JOSENotSupported`, and any other error: `malformed`
   - a JWKS or metadata fetch failure: `keys_unavailable`
6. The `azp` rule (OIDC Core 3.1.3.7, steps 4-5) applies to ID tokens only. The back-channel logout
   spec does not define `azp` for logout tokens.
   - `if (check.typ === 'id_token' && Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp === undefined) return { ok: false, reason: 'azp' }`
   - `if (check.typ === 'id_token' && payload.azp !== undefined && payload.azp !== client.config.clientId) return { ok: false, reason: 'azp' }`

`jose` becomes a runtime `dependency` of `@lupinum/better-convex-nuxt`, pinned at `6.2.3` and moved
from `devDependencies`. Reason: our verifier needs `jwtVerify`, `createLocalJWKSet` and
`decodeProtectedHeader` with our own allow-list, cache and fetch. Better Auth's exported
`verifyJwsAccessToken` refetches on every unknown `kid` without a cooldown, and its fetch has no
timeout (`CORE/oauth2/verify.mjs:31-44`, `:46-53`). The version is already installed (F26), so the
24-hour quarantine is not affected.

### 3.3 One fetch path for every IdP call (`oidc-fetch.ts`)

```ts
export function oidcDeadline(): number
export async function idpFetch(
  url: string,
  init: {
    readonly method: 'GET' | 'POST'
    readonly headers?: Record<string, string>
    readonly body?: URLSearchParams
  },
  limits: { readonly deadline: number; readonly maxBytes: number },
): Promise<{ readonly status: number; readonly json: Record<string, unknown> | null }>
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null>
```

- **Deadline.** One deadline covers a whole operation: a provider method, one back-channel request,
  or one refresh (metadata, then token, then JWKS). Each fetch gets the time that is left. The
  timer line is written exactly as
  `const timer = setTimeout(() => fail(new OidcError('AUTH_OIDC_TRANSPORT', 'timeout')), Math.max(0, limits.deadline - Date.now()))`.
  An `AbortController` aborts the request, and the timer races the fetch with `Promise.race`, so the
  deadline holds even if the runtime ignores `signal`.
- **Redirects.** Use `redirect: 'manual'`. The line is
  `if (response.type === 'opaqueredirect' || REDIRECT_STATUSES.has(response.status)) throw new OidcError('AUTH_OIDC_TRANSPORT', 'redirect')`,
  with `REDIRECT_STATUSES` = 301, 302, 303, 307, 308.
- **Size.** If `Content-Length` is above the limit, throw before reading. Otherwise read the stream
  and count bytes:
  `if (received > limits.maxBytes) throw new OidcError('AUTH_OIDC_TRANSPORT', 'too_large')`.
- **Network errors.** Throw `OidcError('AUTH_OIDC_TRANSPORT', 'network')`.
- **Body.** An empty or non-JSON body gives `json: null`. A JSON array also gives `json: null`.
- **Headers.** Always send `accept: application/json`.
- The caller decides about the status.

`OidcError` is defined in `oidc-fetch.ts`:

```ts
export class OidcError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    readonly detail?: string,
  ) {
    super(detail === undefined ? code : `${code}:${detail}`)
  }
}
```

The message matches `OWNED_CODE` (`diagnostics.ts:33`), so `sanitizeAuthCause` logs it unredacted.

Add `logOidcFailure` to `diagnostics.ts`:

```ts
export function logOidcFailure(
  code: string,
  details?: { readonly cause?: unknown; readonly expected?: string; readonly received?: string },
): void
```

It calls `console.error('[better-convex] AUTH_OIDC_FAILURE', { code, cause, expected, received })`.
`cause` goes through `sanitizeAuthCause`. `expected` and `received` are issuer strings. They bypass
the sanitizer, because `TOKEN_LIKE` would redact a long URL path. They are cut to 2048 characters
and control characters are removed. Only the issuer mismatch passes them. No call ever passes the
client secret, a token or a request.

`OidcErrorCode` (the full list; all are log-only):

- `AUTH_OIDC_TRANSPORT`
- `AUTH_OIDC_DISCOVERY_FAILED`
- `AUTH_OIDC_DISCOVERY_INVALID`
- `AUTH_OIDC_ISSUER_MISMATCH`
- `AUTH_OIDC_JWKS_FAILED`
- `AUTH_OIDC_TOKEN_REQUEST_FAILED`
- `AUTH_OIDC_ID_TOKEN_INVALID`
- `AUTH_OIDC_LOGOUT_TOKEN_INVALID`
- `AUTH_OIDC_LOGOUT_REPLAYED`
- `AUTH_OIDC_LOGOUT_REVOKE_FAILED`
- `AUTH_OIDC_REFRESH_FAILED`
- `AUTH_OIDC_GRANT_ENDED`
- `AUTH_OIDC_CLIENT_REJECTED`
- `AUTH_OIDC_REFRESH_DELEGATED`
- `AUTH_OIDC_ACCOUNT_CONFLICT`

The discovery and JWKS loaders catch `AUTH_OIDC_TRANSPORT` and throw their own code with the same
detail, for example `AUTH_OIDC_DISCOVERY_FAILED:timeout`.

**Token endpoint** (`client.requestTokens`):

```ts
type OidcGrant =
  | {
      readonly type: 'authorization_code'
      readonly code: string
      readonly codeVerifier: string
      readonly redirectURI: string
    }
  | { readonly type: 'refresh_token'; readonly refreshToken: string }
type OidcTokenResult =
  | { readonly ok: true; readonly tokens: OAuth2Tokens }
  | { readonly ok: false; readonly status: number; readonly error: string | null }
```

1. Build the request with core `authorizationCodeRequest` or `refreshAccessTokenRequest` (F20).
   Pass `options: { clientId, clientSecret }` (never `redirectURI` in `options`),
   `tokenEndpoint`, and `tokenEndpointAuth: { method: metadata.tokenEndpointAuthMethod }`.
2. Send it with `idpFetch(tokenEndpoint, { method: 'POST', headers, body }, { deadline, maxBytes: OIDC_MAX_RESPONSE_BYTES })`.
3. Interpret the response:
   - Status 200 with an object is accepted only if:
     - `access_token` is a non-empty string;
     - `token_type`, if present, is `bearer` (case-insensitive).

     Then `tokens = applyDefaultAccessTokenExpiry(getOAuth2Tokens(json), OIDC_DEFAULT_ACCESS_TOKEN_SECONDS)`.
     Otherwise throw `OidcError('AUTH_OIDC_TOKEN_REQUEST_FAILED', 'response')`.

   - Any other status returns `{ ok: false, status, error }`. `error` is `json.error` if it is a
     string, otherwise `null`. It does not set the failure backoff.
   - A transport failure sets the failure backoff and throws `AUTH_OIDC_TOKEN_REQUEST_FAILED:<detail>`.

### 3.4 The provider object (`oidc-provider.ts`)

`createOidcProvider(client: OidcClient): OAuthProvider<OidcIdTokenClaims>` builds the object,
deep-freezes it (the object and its `options`), and adds it to a module `WeakSet`.
`isOwnedOidcProvider(value): boolean` checks that set. S2 confirms with the e2e suite of S5a that
BA never writes to a provider object (a write to a frozen object throws in strict mode).

| Field                                    | Value                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                     | `'oidc'`                                                                                                                                                                                                                                              |
| `name`                                   | `'OIDC'`                                                                                                                                                                                                                                              |
| `issuer`                                 | `client.config.issuer` (makes F4 compare against the right value)                                                                                                                                                                                     |
| `requiresIdTokenNonce`                   | `true`                                                                                                                                                                                                                                                |
| `idToken`                                | absent. So `supportsIdTokenSignIn` is false (F7).                                                                                                                                                                                                     |
| `allowIdpInitiated`                      | absent                                                                                                                                                                                                                                                |
| `disableImplicitSignUp`, `disableSignUp` | absent                                                                                                                                                                                                                                                |
| `options`                                | `{ clientId, clientSecret, disableIdTokenSignIn: true, overrideUserInfoOnSignIn: false }`, one field per line                                                                                                                                         |
| `accountSubject`                         | `async ({ profile }) => client.accountKey(profile.sub)` (F29). `getUserInfo` has already checked `sub`.                                                                                                                                               |
| `createAuthorizationURL(data)`           | see below                                                                                                                                                                                                                                             |
| `validateAuthorizationCode(data)`        | see below                                                                                                                                                                                                                                             |
| `getUserInfo(tokens)`                    | see below                                                                                                                                                                                                                                             |
| `refreshAccessToken`                     | `refreshAccessToken: async () => { throw new OidcError('AUTH_OIDC_REFRESH_DELEGATED') },`. One refresh owner (section 5). `auth.api.getAccessToken`, `auth.api.refreshToken` and `/account-info` can therefore never refresh this account (F12, F38). |
| `createEndSessionURL(data)`              | see 4.7                                                                                                                                                                                                                                               |
| `revokeToken`                            | absent                                                                                                                                                                                                                                                |

**`createAuthorizationURL({ state, codeVerifier, idTokenNonce, redirectURI })`.** It ignores
`scopes`, `loginHint`, `display` and `additionalParams` (F8).

1. If `codeVerifier` or `idTokenNonce` is empty, throw `OidcError('AUTH_OIDC_DISCOVERY_INVALID', 'request')`.
   This cannot happen with F5, but it fails closed if BA changes.
2. Resolve the metadata with `oidcDeadline()`. On failure, call `logOidcFailure` and
   `throw new APIError('SERVICE_UNAVAILABLE', { code: 'OIDC_UNAVAILABLE', message: 'OIDC_UNAVAILABLE' })`.
3. Return core `createAuthorizationURL` with these arguments:
   - `id: 'oidc'`
   - `options: { clientId, clientSecret }`
   - `authorizationEndpoint`
   - `state`, `codeVerifier`, `redirectURI`
   - `scopes: OIDC_SCOPES,`
   - `nonce: idTokenNonce`

**`validateAuthorizationCode({ code, codeVerifier, redirectURI })`.** One deadline covers it.

1. If `codeVerifier` is missing, throw.
2. Call `client.requestTokens({ type: 'authorization_code', code, codeVerifier, redirectURI }, deadline)`.
   If it is not `ok`, throw `OidcError('AUTH_OIDC_TOKEN_REQUEST_FAILED', String(status))`.
3. If `tokens.idToken` is not a string, throw `OidcError('AUTH_OIDC_ID_TOKEN_INVALID', 'missing')`.
4. Return the tokens.

BA maps any throw here to `error=invalid_code` (`BA/api/routes/callback.mjs:107-118`).

**`getUserInfo(tokens)`.** It never calls the userinfo endpoint. One deadline covers it. Any failure
logs `AUTH_OIDC_ID_TOKEN_INVALID:<reason>` and returns `null`, which BA maps to
`unable_to_get_user_info`. The callback therefore runs under at most two deadlines (20 s).

1. `if (typeof tokens.idToken !== 'string' || typeof tokens.expectedIdTokenNonce !== 'string') return reject('missing')`.
   This also refuses BA paths that call `getUserInfo` without a nonce: the id-token sign-in and `/account-info`.
2. `result = await client.verifyJwt(tokens.idToken, { typ: 'id_token', requiredClaims: ['iss','sub','aud','exp','iat','nonce'], maxTokenAgeSeconds: OIDC_ID_TOKEN_MAX_AGE_SECONDS }, deadline)`.
   If it is not `ok`, return `reject(result.reason)`.
3. Nonce: `if (typeof claims.nonce !== 'string' || claims.nonce !== tokens.expectedIdTokenNonce) return reject('nonce')`.
4. Subject: `if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) return reject('subject')`.
5. Mapping (no `mapProfileToUser`, no `id`, F23). Only these four keys go into `user`, so no ID-token
   claim reaches an additional user field (F34):

   ```ts
   user: {
     email: typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : undefined,
     emailVerified: claims.email_verified === true,
     name: displayName(claims),   // name, else "given_name family_name" trimmed, else preferred_username, else ''
     image: httpsUrlOrUndefined(claims.picture),
   },
   data: claims,
   ```

   Only the boolean `true` counts as verified. The string `"true"` does not. A missing `email`
   makes BA answer `email_not_found` (`BA/api/routes/callback.mjs:166-169`).

### 3.5 RFC 9207 `iss`: BA's check only, no extra hook

BA compares `iss` with `provider.issuer` whenever the callback carries it (F4), and our provider sets
`issuer`. This design adds no hook that requires `iss`. Reason: the mix-up attack needs a client
that cannot tell which authorization server a callback belongs to. Here every provider has its own
redirect URI (`/callback/:id`), the `oidc` id is unique (3.9), the token endpoint is fixed per
provider, and the ID token's `iss`, `aud` and nonce are verified. Distinct redirect URIs per
authorization server are the countermeasure the OAuth security BCP accepts besides `iss`. A required
`iss` would add a hook on BA's internal `ctx.path`, a query rewrite, a sentinel and an error code,
and close no remaining attack. D52 records this.

### 3.6 Mandatory checks: summary

| Check                                                              | Where                                                     | Configurable |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ------------ |
| Exact issuer equality                                              | discovery step 1                                          | no           |
| Account key bound to the issuer                                    | `accountKey` (3.2)                                        | no           |
| https only (loopback http), no credentials or fragment             | `isAllowedIdpUrl` for the issuer and every discovered URL | no           |
| No redirects, one 10 s deadline per operation, 64 KiB limit        | `idpFetch`                                                | no           |
| Failure backoff (10 s per isolate)                                 | `IssuerState.failure`                                     | no           |
| PKCE S256                                                          | core `createAuthorizationURL` (F21), discovery step 5     | no           |
| State                                                              | BA `parseState` (F6)                                      | no           |
| Nonce generated and bound                                          | `requiresIdTokenNonce` (F5), `getUserInfo` step 3         | no           |
| ID token required                                                  | `validateAuthorizationCode` step 3, `getUserInfo` step 1  | no           |
| Signature, `iss`, `aud`, `exp`, `iat` age, `azp` (ID token), `typ` | `verifyJwt`                                               | no           |
| Algorithm allow-list (asymmetric only)                             | discovery step 6, `verifyJwt` steps 3-4                   | no           |
| RFC 9207 `iss` equal when present                                  | F4                                                        | no           |
| Client id-token sign-in closed                                     | no `idToken` config (F7), `disableIdTokenSignIn`          | no           |
| Client scopes and params ignored                                   | `createAuthorizationURL`                                  | no           |
| IdP-managed users use only the IdP door                            | session guard (3.8)                                       | no           |
| One `oidc` account per user                                        | account guard (3.8)                                       | no           |

### 3.7 `email_verified`

- A new user needs `email_verified === true`. Otherwise the existing guard refuses creation with
  `AUTH_USER_CREATE_UNVERIFIED_EMAIL` (`identity-guards.ts:69-78`, wired at `cba:1322-1328`).
- A user who is already linked by `(oidc, key)` signs in whatever the IdP says about the email.
  The account key is the identity.
- When a linked user's local address is unverified and the IdP reports the same address as
  verified, BA marks it verified (`BA/oauth2/link-account.mjs:188`). Our hook then ends the earlier
  sessions (`identity-guards.ts:41-60`). This is existing behaviour.

### 3.8 Account linking and door rules

1. BA looks up the account by `(oidc, key)` first (`BA/oauth2/link-account.mjs:80-105`). A found
   account always signs in its own user. A changed email at the IdP is not copied
   (`overrideUserInfoOnSignIn: false`), so the stored email can be stale (documented limit).
2. When no account and no user exist for the email, a user is created. This requires
   `email_verified` and `beforeUserCreate`.
3. When no account exists but a user has the same email, sign-in is refused with
   `account_not_linked` (F10). The person signs in the old way and calls
   `client.linkSocial({ provider: 'oidc' })`. Linking requires the same email (factory:
   `allowDifferentEmails: false`) and a verified IdP email (F11; `oidc` cannot be trusted, 2.3).
4. Unlinking the last account is refused (factory: `allowUnlinkingAll: false`).
5. **One `oidc` account per user.** BA would create a second `oidc` row for a link with another
   subject (F33), and the helper could then hand out another principal's token. The plugin's
   `account.create.before` hook (F32) refuses it with this line:
   `if (account.providerId === OIDC_PROVIDER_ID && (await hasOidcAccount(account.userId))) throw oidcAccountConflict()`.
   `oidcAccountConflict()` is `new APIError('FORBIDDEN', { code: 'OIDC_ACCOUNT_CONFLICT', message: 'OIDC_ACCOUNT_CONFLICT' })`
   and logs `AUTH_OIDC_ACCOUNT_CONFLICT`. S5a confirms the redirect error BA shows for a throw in
   the link flow and documents it.
   The check and the insert are separate adapter calls, so two link callbacks that run at the same
   time can both pass it. Accepted (S-m10): only the user can cause it, it needs two IdP subjects
   with the user's verified email, and the result fails closed (`findAccountForUser` returns
   `'conflict'`, so no token is handed out).
6. **IdP-managed users.** A user who has an `oidc` account may get a new session only from
   `/callback/oidc`. The plugin's `session.create.before` hook (F32) has this line:
   `if (!isOidcCallback(context) && (await hasOidcAccount(session.userId))) throw oidcSignInRequired()`,
   with:
   - `isOidcCallback(context)` is `context?.path === '/callback/:id' && context.params?.id === OIDC_PROVIDER_ID`.
     A missing context counts as "not the callback".
   - `hasOidcAccount(userId)` is
     `(await internalAdapter().findAccounts(userId)).some((account) => account.providerId === OIDC_PROVIDER_ID)`.
   - `oidcSignInRequired()` is `new APIError('FORBIDDEN', { code: 'OIDC_SIGN_IN_REQUIRED', message: 'OIDC_SIGN_IN_REQUIRED' })`.

   Effect: password, email code, magic link, passkey, other social providers and the e-mail
   verification auto sign-in all refuse an IdP-managed user. Disabling the user at the IdP, or a
   recycled address at the company, cannot be bypassed through the app's other doors. Cost: one
   indexed account read per new session. Side effects (documented, Q5): there is no password
   fallback while the IdP is down, and `/change-password` of a linked user with a password fails
   at its new-session step after it has ended the other sessions.

7. **The `oidc` account cannot be unlinked.** Without its `oidc` row a user leaves rule 6, the
   back-channel logout and the mint liveness check. A linked password user has two accounts, so
   rule 4 does not stop `/unlink-account`. The plugin's `account.delete.before` hook refuses it:
   `if (account.providerId === OIDC_PROVIDER_ID && context?.path === '/unlink-account') throw oidcUnlinkRefused()`,
   with `oidcUnlinkRefused()` as `new APIError('FORBIDDEN', { code: 'OIDC_UNLINK_REFUSED', message: 'OIDC_UNLINK_REFUSED' })`.
   `/delete-user` still deletes the row together with the user.

### 3.9 Owned invariant after construction

In `createAuthWithProfile`, after `await auth.$context` (`cba:1440-1442`), write the call as one line:
`if (!oidcProviderInvariantHolds(context, oidcConfig)) throw new Error('AUTH_OWNED_INVARIANT_VIOLATED')`.

The function returns `true` only when:

- **Without `oidc`:** no entry of `context.socialProviders` has `id === 'oidc'`.
- **With `oidc`:** exactly one entry has `id === 'oidc'`, and it passes `isOwnedOidcProvider`.

The object is deep-frozen (3.4), so its fields are our own constants; checking them again would
test our own literals. `assertOwnedInvariants` (`cba:1016-1043`) is unchanged: `trustedProviders`
can never name `oidc` (2.3).

### 3.10 Plugin assembly (`oidc-plugin.ts`)

```ts
export function createOidcPlugin(input: {
  readonly config: ResolvedOidcConfig
  readonly consume: () => ConsumeRateLimit // same shape as email-code-limit.ts:4-7
}): { readonly plugin: BetterAuthPlugin; readonly runtime: OidcRuntime }

interface OidcRuntime {
  /** Filled in `init`; throws AUTH_OIDC_NOT_INITIALIZED before. */
  upstream(): OidcUpstream
}
```

`plugin` has these parts:

- `id: 'better-convex-oidc'`
- `init(ctx)`:
  - If an existing `ctx.socialProviders` entry has `id === 'oidc'`, throw
    `Error('AUTH_OWNED_INVARIANT_VIOLATED')`.
  - Define `const internalAdapter = () => ctx.internalAdapter`. Every dependency reads the adapter
    through it when it runs, because BA replaces the adapter after all plugin inits (F15).
  - Define the shared grant end, one owner for "this user's IdP grant is over":

    ```ts
    const endGrant = async (userId: string) => {
      await internalAdapter().deleteUserSessions(userId)
      await clearOidcTokens(userId)
    }
    ```

    `clearOidcTokens(userId)` updates the user's `oidc` account with `accessToken`, `refreshToken`,
    `idToken`, `accessTokenExpiresAt` and `refreshTokenExpiresAt` set to `null`. The call is written
    exactly as `await clearOidcTokens(userId)`.

  - Build the provider and the upstream (5.2). The upstream gets these dependencies:
    - `findAccountForUser` (5.2), with the line
      `const accounts = (await internalAdapter().findAccounts(userId)).filter((account) => account.providerId === OIDC_PROVIDER_ID)`;
    - `swapTokens` (5.2), written as one line:
      `swapTokens: async (id, expectedRefreshToken, patch) => (await ctx.adapter.update({ model: 'account', where: [{ field: 'id', value: id }, { field: 'refreshToken', value: expectedRefreshToken }], update: patch })) !== null,`
      (F37);
    - `endGrant`;
    - `seal = (t) => setTokenUtil(t, ctx)`;
    - `open`, which refuses a value without BA's envelope (F31):

      ```ts
      const open = async (sealed: string) => {
        if (!sealed.startsWith('$ba$')) throw new OidcError('AUTH_OIDC_REFRESH_FAILED', 'decrypt')
        return await decryptOAuthToken(sealed, ctx)
      }
      ```
  - Return `{ context: { socialProviders: [provider, ...ctx.socialProviders] }, options: { databaseHooks } }`,
    where `databaseHooks` holds the `session.create.before` and `account.create.before` guards from 3.8.
- `rateLimit: [{ pathMatcher: (path) => path === OIDC_BACKCHANNEL_LOGOUT_PATH, ...OIDC_BACKCHANNEL_RATE_LIMIT }]`
- `onRequest(request, ctx)`:
  - When the path relative to `new URL(ctx.baseURL).pathname` equals `OIDC_BACKCHANNEL_LOGOUT_PATH`,
    return `{ response: await handleOidcBackchannelLogout(request, deps) }`.
  - Otherwise return nothing.

There is no `hooks.before` entry (3.5).

Factory wiring in `createAuthWithProfile`:

1. Resolve the config with the stage set to `AUTH_CONFIG_OIDC_INVALID`.
2. Insert the plugin after `createIdentityGuardsPlugin()` and before `extraPlugins`.
3. Store `runtime` in a module `WeakMap<BetterConvexAuthInstance, OidcRuntime>` keyed by the
   returned `auth`. `getOidcAccessToken` reads it from there.
4. Pass `beforeMint` to `convexAuth` (4.6). This step belongs to S5b.

## 4. Central logout

### 4.1 Route

- Path: `POST /api/auth/oidc/backchannel-logout`.
- It is served by the existing `registerRoutes` `/api/auth/` prefix (`cac:466-488`), so there is no
  new Convex route.
- It is answered in the plugin's `onRequest` (F13). No BA endpoint exists for it, so the origin
  check (F14), the cookie session and CSRF never run. The signed logout token is the only gate.
- The IdP registers `${CONVEX_SITE_URL}/api/auth/oidc/backchannel-logout`. This is recommended: it
  makes one hop and works while Nuxt is down. The client IP is the IdP's (F25).
- `${SITE_URL}/api/auth/oidc/backchannel-logout` through the Nuxt proxy also works. In that case
  the ingress must set the trusted client-IP header when one is configured.

### 4.2 Handler (`oidc-backchannel-logout.ts`)

```ts
export interface OidcBackchannelDeps {
  readonly client: OidcClient
  readonly consume: ConsumeRateLimit
  readonly findUserIdBySubject: (sub: string) => Promise<string | null>
  readonly endGrant: (userId: string) => Promise<void>
}
export async function handleOidcBackchannelLogout(
  request: Request,
  deps: OidcBackchannelDeps,
): Promise<Response>
```

Every response carries `Cache-Control: no-store`. Error bodies are exactly
`{"error":"invalid_request"}` or `{"error":"temporarily_unavailable"}`. A body never names the
failed check. The log gets `AUTH_OIDC_LOGOUT_TOKEN_INVALID:<reason>`. One deadline
(`oidcDeadline()`) covers the request. Steps, in order:

1. If the method is not `POST`: answer **405** with `Allow: POST` and an empty body.
2. If `Content-Type` is not `application/x-www-form-urlencoded`: answer **400**
   (reason `content_type`). Media-type parameters such as `charset` are allowed.
3. Body: `const body = await readBodyCapped(request, OIDC_LOGOUT_MAX_BODY_BYTES)`. When it returns
   `null` (over 16 KiB): answer **400** (`body`).
4. Parse `new URLSearchParams(body)`. If `getAll('logout_token')` does not have exactly one
   non-empty entry: answer **400** (`missing`).
5. Run `client.verifyJwt(token, { typ: 'logout_token', requiredClaims: ['iss','aud','iat','jti','events'], maxTokenAgeSeconds: OIDC_LOGOUT_TOKEN_MAX_AGE_SECONDS }, deadline)`.
   Size, `typ` and the static algorithm list are checked before any fetch (3.2 steps 1-3). This
   covers spec §2.6 steps 1-4:
   - signature with the JWKS;
   - `alg` from the allow-list;
   - `iss` equals the issuer;
   - `aud` contains `clientId`;
   - `iat` at most 300 s old and at most 60 s in the future (±60 s tolerance);
   - `exp` checked when present.

   The result is mapped like this:
   - `keys_unavailable` (fetch failure, backoff, or an unknown `kid` inside the key cooldown):
     answer **503** with `temporarily_unavailable` and `Retry-After: 30`, and log
     `AUTH_OIDC_JWKS_FAILED`. Nothing has changed, so the IdP's retry is safe.
   - Other failures: answer **400**.

6. Events: `if (!isPlainRecord(events) || !isPlainRecord(events[BACKCHANNEL_LOGOUT_EVENT])) return invalid('events')`.
7. Nonce: `if ('nonce' in payload) return invalid('nonce')`.
8. Subject: `if (typeof payload.sub !== 'string' || payload.sub.length === 0) return invalid('sub')`.
   A logout token with only `sid` is refused with 400, because we cannot map `sid` (plan decision 2).
   Keycloak always sends `sub`; the Keycloak suite asserts this. If `sid` is present, it must be a
   string, otherwise `invalid('sid')`.
9. `jti` must be a string of length 1-256, otherwise `invalid('jti')`.
10. Replay:

    ```ts
    const replay = await deps.consume(`oidc-logout-jti:${payload.jti}`, {
      window: OIDC_LOGOUT_JTI_WINDOW_SECONDS,
      max: 1,
    })
    if (!replay.allowed) return invalid('replay')
    ```

    The answer is **400**, and the log gets `AUTH_OIDC_LOGOUT_REPLAYED`. The 600 s window is longer
    than the acceptance window (`iat` + 300 s + 2×60 s tolerance). A replayed token is therefore
    either seen in the cache or rejected by its age. The key holds the raw `jti`: it is a random
    id, not a secret, its length is capped at 256, and there is one issuer.

11. `const userId = await deps.findUserIdBySubject(payload.sub)`. If it is `null`: answer **200**.
    There is nothing to end, and the effect is idempotent.
12. `await deps.endGrant(userId)`. If it throws: answer **500** with an empty body and log
    `AUTH_OIDC_LOGOUT_REVOKE_FAILED`.
13. Answer **200** with an empty body.

The plugin fills the dependencies:

```ts
findUserIdBySubject: async (sub) => (await internalAdapter().findAccountByKey({ providerId: OIDC_PROVIDER_ID, accountId: await client.accountKey(sub) }))?.userId ?? null,
endGrant,
consume: input.consume(),
```

### 4.3 Replay cache storage, without a schema change

The replay cache is the component `rateLimit` table, through `consumeRateLimit` with `max: 1`
(F18). It is one atomic mutation: check and insert happen together.

- Rows expire through the existing cleanup scheduler, with `retentionWindow >= window`. The storage
  passes `max(60, configured plugin windows, rule.window)` (`rate-limit-storage.ts:58-62`).
- The `verification` table was rejected: its check and insert are two calls, so they are not atomic.

### 4.4 What a logout ends

- **Sessions.** All sessions of the user that owns the account `(oidc, key)`. `deleteUserSessions`
  bumps `bcnSecurityGeneration` (F16).
- **Stored IdP tokens.** `endGrant` clears the access, refresh and ID tokens of the `oidc` account.
  A Keycloak access token is a self-contained JWT that internal services accept until `exp`, so
  `getOidcAccessToken` must not hand it out after a logout. The next IdP sign-in stores new tokens.
- **Session checks.** `auth.getUser`, `auth.requireUser`, `auth.getAuth` and `sessionHttpAction`
  deny at once (`session-generation.ts:178-205`).
- **Convex token mint.** `/convex/token` refuses. BA's session lookup hides stale sessions
  (`session-generation.ts:148-158`).
- **MCP.** OAuth refresh grants tied to those sessions fail admission.
- **Already issued Convex tokens.** They stay valid for at most 15 minutes, but only at functions
  that use raw `ctx.auth.getUserIdentity()`. This matches `.github/SECURITY.md` "What remains your
  responsibility".
- **Cookie cache.** With `session.cookieCache`, BA's own endpoints (`get-session`, `link-social`)
  can accept the ended session for up to `maxAge` (at most 300 s) (2.4).
- **Granularity.** A user with sessions from two IdP sessions (two devices) loses both. This is
  the documented limit of plan decision 5. The device whose IdP session is still alive signs in
  again without a password prompt.

### 4.5 Limits and idempotency

- **Rate limit.** The plugin rule allows 600 requests per 60 s per client IP. The signature check
  is the real gate:
  - No database write happens before a valid signature.
  - Tokens with a disallowed `alg`, a bad `typ` or too many bytes are refused before any fetch.
  - Forged `kid` values cost at most one JWKS fetch per 30 s.
  - While the IdP fails, the failure backoff answers without a fetch.
  - 600 per minute leaves room for a realm-wide logout burst. A dropped call (429) is caught by the
    liveness check (4.6) where it applies.
- **Body.** At most 16 KiB. The token has its own limit of 16 KiB (`verifyJwt`).
- **Idempotency.**
  - A repeated `jti` within 600 s changes nothing and answers 400, as spec §2.8 requires for an
    invalid token.
  - An unknown `sub` answers 200.
  - Two logouts for the same user bump the generation twice. Sessions created between them would
    end, but that needs two distinct valid tokens from the IdP.
- **Known loss case.** Step 12 fails after step 10 consumed the `jti`. A retry with the same token
  then answers 400, and the logout is lost. Convex retries OCC conflicts inside the mutation, so
  this needs a hard backend failure. The liveness check limits the damage where it applies. We
  accept this. The ordering keeps replay protection strict.

### 4.6 Liveness check for IdPs that cannot call back

**Problem.** Back-channel logout does not cover every case:

- Many IdPs never send back-channel logout. Examples: Microsoft Entra ID, Google, and Okta's
  standard OIDC.
- Keycloak does not send it when an SSO session expires by idle or maximum time.
- A call can be dropped (429, network, 4.5).

Without a check, the app session lives its full lifetime (up to 30 days) after the IdP ended it.

**Mechanism.** The upstream refresh runs at Convex token mint.

1. `convexAuth` (`plugin.ts`) gets an option:
   `readonly beforeMint?: (input: { readonly context: AuthContext; readonly session: Session; readonly user: User }) => Promise<boolean>`.
   Right after the persisted-user check (`plugin.ts:956-960`), add one line:
   `if (options.beforeMint && !(await options.beforeMint({ context: ctx.context, session: persistedSession, user: persistedUser }))) unauthorized()`.
2. With `oidc`, `beforeMint` is `({ user }) => runtime.upstream().isGrantLive(user.id)`. It returns
   `false` only when the IdP answered `invalid_grant` for this user's refresh token now. Then the
   user's sessions have already ended (section 5).
3. `isGrantLive(userId)` works like this:
   - No `oidc` account, or no stored refresh token: `true`.
   - The access token expires more than `OIDC_REFRESH_MARGIN_MS` (60 s) from now: `true`, with no
     IdP call.
   - Otherwise it runs the shared refresh (section 5) with one deadline (10 s):
     - `fresh` or `busy`: `true`
     - `unavailable`: `true` (fail open, logged)
     - `ended`: `false`
   - Any thrown error: `true` (fail open, logged).

**What it guarantees.** It ends app sessions when the IdP refuses the refresh token: the grant was
revoked, the user was disabled, or, on IdPs that bind refresh tokens to the SSO session (Keycloak),
the IdP session ended. Many IdPs (Google, Microsoft Entra ID, Okta by default) keep refresh tokens
valid after the user signs out at the IdP. There the check catches revocation and disabled users,
not an IdP sign-out.

**Bound.** After the IdP refuses the grant, the next mint ends the sessions. A mint refreshes when
the stored upstream access token is within 60 s of expiry, and an open tab mints at least every
15 minutes. So:

- functions that use the live session checks deny within the upstream access-token lifetime plus
  15 minutes (about 20 minutes with Keycloak's default 5-minute access tokens);
- functions that use raw `ctx.auth.getUserIdentity()` accept the last Convex token for up to
  15 minutes more (about 35 minutes with Keycloak defaults);
- with no open tab, it happens at the next visit.

**Cost.**

- Per mint, with `oidc` on: one extra indexed account read (`userId` index, `schema.ts:57`).
- Per mint with an expiring upstream token: one lease mutation, one account read, one IdP token
  call, an optional JWKS fetch, and one compare-and-swap update, all under one 10 s deadline.
- With Keycloak defaults that is about one refresh per active session every 14 minutes. That is
  small IdP load, and it adds one IdP round trip to that mint.
- While the IdP fails, the failure backoff limits each isolate to one attempt per 10 s. The other
  mints in that time skip the call and go on.
- An IdP outage does not sign anyone out (fail open). One exception, documented: a refresh that
  times out after the IdP already rotated the refresh token loses the grant (5.2 step 6). The next
  refresh gets `invalid_grant` and ends the sessions; the user signs in again through the IdP,
  usually without a password prompt because the IdP session is still alive.
- Build cost: about 1.5 days, shared with section 5.

**Side effects to document.**

- The app session now follows the IdP grant. Keycloak's SSO idle timeout (30 min by default)
  ends the app session after a closed tab, at the next visit. An open tab refreshes the IdP session
  every ~14 minutes, so it stays alive up to Keycloak's SSO maximum.
- Without a refresh token (the client has "Use refresh tokens" off), there is no check. Only
  back-channel logout ends sessions then.

**Recommendation: yes, always on with `oidc`, and no option.** It is the only mechanism that needs
no callback from the IdP. It covers Keycloak's idle expiry and admin "disable user", and revocation
on every IdP. An outage cannot sign people out. Open question Q4 asks whether an opt-out is needed.

### 4.7 App-to-IdP logout (`createEndSessionURL`)

`createEndSessionURL({ idToken, postLogoutRedirectURI, state })` works like this:

1. Resolve the metadata with `oidcDeadline()`. If that fails, or `endSessionEndpoint` is `null`,
   return `null`. BA then signs out locally only (`BA/api/routes/sign-out.mjs:55-84`).
2. Build `new URL(endSessionEndpoint)`, then set:
   - `client_id = clientId`, always;
   - `id_token_hint = idToken` when it is a non-empty string;
   - `post_logout_redirect_uri` when it is given;
   - `state` when it is given.
3. Return the URL.

The checks around it:

- `postLogoutRedirectURI` comes from the client's `callbackURL`, resolved against `baseURL`. BA's
  origin check validates `callbackURL` against the trusted origins
  (`BA/api/middlewares/origin-check.mjs:47-70`). The IdP checks it again against its registered
  list of exact URIs.
- `idToken` is the stored ID token. It is decrypted by our adapter (F19) and may be expired;
  Keycloak accepts an expired hint (the spike confirmed this: report §5).
- After an ended grant or a back-channel logout, the ID token was cleared. The URL then carries only
  `client_id`, and Keycloak shows its logout confirmation.

**What the Nuxt client needs.** It needs no module change. It needs the documented call from 2.5.
The IdP needs the post-logout URI registered.

## 5. Upstream tokens for calling internal services

### 5.1 Recommendation: a library helper, `auth.getOidcAccessToken(ctx)`

AGENTS.md says a pattern needs three apps before it becomes a helper. This helper is allowed
because it is a correctness owner, not convenience:

- Refreshes must be serialized across isolates, and writes must not overwrite newer tokens (5.2).
- `invalid_grant` must mean "the grant ended" and nothing else.
- A refreshed ID token must be verified before it is stored, because it is later sent as
  `id_token_hint`.
- The same refresh code also serves the liveness check (4.6).

A recipe around `auth.api.getAccessToken` cannot do this, because BA swallows the IdP error (F12)
and has no lock. Our provider therefore refuses BA-driven refresh (`AUTH_OIDC_REFRESH_DELEGATED`).
That keeps one refresh owner.

### 5.2 Shared refresh code (`oidc-upstream.ts`)

```ts
export interface OidcAccountRecord {
  readonly id: string
  readonly userId: string
  readonly accountId: string // the account key `<issuer tag>:<sub>`
  readonly accessToken: string | null // sealed
  readonly refreshToken: string | null // sealed
  readonly idToken: string | null // plaintext (the adapter seals it)
  readonly accessTokenExpiresAt: Date | null
}
export type OidcTokenPatch = {
  readonly accessToken: string
  readonly accessTokenExpiresAt: Date | null
  readonly refreshToken: string | null
  readonly refreshTokenExpiresAt: Date | null
  readonly idToken: string | null
}
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
  readonly endGrant: (userId: string) => Promise<void>
  readonly seal: (token: string) => Promise<string>
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
  accessToken(userId: string): Promise<OidcRefreshOutcome> // helper path, waits while busy
  isGrantLive(userId: string): Promise<boolean> // mint path, never waits
}
export function createOidcUpstream(deps: OidcUpstreamDeps): OidcUpstream
```

`findAccountForUser` returns `'conflict'` when it finds more than one `oidc` account. The account
guard (3.8 rule 5) prevents that for new links; rows from before the guard still fail closed. Every
caller maps `'conflict'` to `unavailable` and logs `AUTH_OIDC_ACCOUNT_CONFLICT`.

`refresh(account, deadline)` is internal. Steps:

1. If `account.accessToken` is set and `accessTokenExpiresAt - Date.now() > OIDC_REFRESH_MARGIN_MS`:
   return `fresh` with `open(accessToken)`.
2. If `account.refreshToken` is not set: return `no-refresh-token`.
3. Lease:

   ```ts
   const lease = await deps.consume(`oidc-refresh-lease:${account.id}`, {
     window: OIDC_REFRESH_LEASE_SECONDS,
     max: 1,
   })
   if (!lease.allowed) return { kind: 'busy' }
   ```

   This is atomic across isolates (F18). The lease (30 s) is longer than the deadline (10 s).

4. `current = await deps.findAccountForUser(account.userId)`. If it is gone: `no-account`. If it is
   `'conflict'`: `unavailable`. If it is now fresh, because another caller refreshed before our
   lease: return `fresh`.
5. `refreshToken = await deps.open(current.refreshToken)`. A failure (no `$ba$` envelope, or a
   decrypt error) gives `unavailable` and logs `AUTH_OIDC_REFRESH_FAILED:decrypt`.
6. `result = await client.requestTokens({ type: 'refresh_token', refreshToken }, deadline)`.
   - A thrown transport error: `return unavailable('transport')`. The log line is
     `AUTH_OIDC_REFRESH_FAILED:<detail>`. A `timeout` here may mean that the IdP already rotated the
     refresh token; the next `invalid_grant` then ends the grant (4.6, documented).
   - `if (!result.ok && result.error === 'invalid_grant') return await endGrantIfUnchanged(current)`.
   - `!result.ok && (result.error === 'invalid_client' || result.error === 'unauthorized_client')`:
     log `AUTH_OIDC_CLIENT_REJECTED` and return `unavailable`.
   - Any other `!result.ok`: return `unavailable`.
7. Success:
   - If `tokens.idToken` is present:
     - `verified = await client.verifyJwt(tokens.idToken, { typ: 'id_token', requiredClaims: ['iss','sub','aud','exp','iat'], maxTokenAgeSeconds: OIDC_ID_TOKEN_MAX_AGE_SECONDS }, deadline)`;
     - `if (verified.ok && (await client.accountKey(String(verified.payload.sub))) !== current.accountId) return unavailable('subject')`.
       In this case nothing is stored.
     - The kept ID token is chosen with the line
       `const idToken = verified.ok ? tokens.idToken : current.idToken`. A failed verification
       drops the new ID token and keeps the old one (logged). The nonce is not checked on refresh.
   - Build `patch: OidcTokenPatch`:
     - `accessToken: await seal(tokens.accessToken)`
     - `accessTokenExpiresAt`
     - `refreshToken: tokens.refreshToken ? await seal(tokens.refreshToken) : current.refreshToken`
     - `refreshTokenExpiresAt`
     - `idToken`
   - Write with compare-and-swap:
     `if (!(await deps.swapTokens(current.id, current.refreshToken, patch))) return { kind: 'busy' }`.
     A sign-in that stored newer tokens between step 4 and now keeps them. Our new tokens are
     dropped; with rotation, that loses only our grant, which the IdP session no longer needs.
   - Return `fresh`.
8. `endGrantIfUnchanged(current)`, on `invalid_grant`:
   - Re-read: `latest = await deps.findAccountForUser(current.userId)`. Then
     `if (latest === 'conflict' || latest?.refreshToken !== current.refreshToken) return { kind: 'busy' }`.
     A new sign-in or another writer stored new tokens, so this is not an ended grant.
   - Otherwise:
     - `await deps.endGrant(current.userId)` (sessions first, then the tokens, 3.10);
     - log `AUTH_OIDC_GRANT_ENDED`;
     - return `ended`.

`accessToken(userId)`:

1. Find the account. If there is none: `no-account`. If it is `'conflict'`: `unavailable`.
2. `const deadline = oidcDeadline()`, then run `refresh(account, deadline)`.
3. On `busy`: re-read the account every `OIDC_BUSY_POLL_INTERVAL_MS` (500 ms) while
   `Date.now() < deadline + 1_000`. The lease holder's own deadline is at most 10 s, so the waiter
   outlasts it. As soon as the account is fresh by step 1's rule, return it. After that, return
   `unavailable`. The waits use `setTimeout`, so tests drive them with fake timers.

`isGrantLive(userId)` follows 4.6 and never waits.

The helper in `cba` maps the outcomes like this. Every error is
`new ConvexError({ code, message })`, with the same shape as `requireUser` (`cac:310-320`).

1. Action check: `if ('db' in ctx || typeof ctx.runAction !== 'function') throw new TypeError('AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION')`.
2. `const oidcUser = await requireUser(ctx)`. This throws `UNAUTHENTICATED` and uses the live
   session check.
3. `auth = await createAuth(ctx)`, then `runtime = oidcRuntimes.get(auth)`. Without `oidc`, throw
   `TypeError('AUTH_OIDC_NOT_CONFIGURED')`.
4. Map the outcome of `runtime.upstream().accessToken(oidcUser.id)`:

   | Outcome                     | Result                                                                            |
   | --------------------------- | --------------------------------------------------------------------------------- |
   | `fresh`                     | `{ accessToken, expiresAt }`                                                      |
   | `no-account`                | `OIDC_ACCOUNT_REQUIRED`, "Sign in through the identity provider or link it first" |
   | `no-refresh-token`, `ended` | `OIDC_SIGN_IN_REQUIRED`, "Sign in through the identity provider again"            |
   | `busy`, `unavailable`       | `OIDC_UNAVAILABLE`, "The identity provider is not available. Try again later"     |

Helper cost (for the docs):

- One component query for the session check.
- One auth construction, with no fetch.
- One account read.
- On refresh, additionally: one rate-limit mutation, one account read, one IdP call, an optional
  JWKS fetch, and one compare-and-swap mutation. While another call holds the lease, one account
  read every 500 ms for at most 11 s.
- No app tables are read, and no query subscriptions are invalidated. Nothing subscribes to `account`.

### 5.3 Race handling summary

| Race                                                        | Handling                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Two actions or tabs need a refresh at once, in any isolates | The lease (step 3) lets one call the IdP. The others wait (helper) or go on (mint).                                                       |
| The lease holder reads an old refresh token                 | Step 4 re-reads after taking the lease.                                                                                                   |
| Refresh-token rotation (Keycloak "Revoke Refresh Token")    | Only one call per account per 30 s reaches the IdP, so a reused token is impossible from our side.                                        |
| A sign-in writes new tokens while a refresh runs            | Step 7 writes only if the stored refresh token is unchanged (compare-and-swap, F37).                                                      |
| `invalid_grant` while a new sign-in writes tokens           | Step 8 re-reads first and does not end the sessions.                                                                                      |
| The refresh times out after the IdP rotated the token       | The grant is lost. The next refresh gets `invalid_grant` and ends the sessions (documented, 4.6). The deadline is 10 s to make this rare. |
| The lease holder crashes                                    | The lease expires after 30 s.                                                                                                             |
| BA's own refresh paths                                      | Refused (`AUTH_OIDC_REFRESH_DELEGATED`), so they never race us.                                                                           |

### 5.4 Encryption at rest and boundaries

- Access and refresh tokens are sealed with `setTokenUtil`. This is BA symmetric encryption with
  `BETTER_AUTH_SECRETS`. `open` refuses a value without the `$ba$` envelope (F31), the same rule as
  our ID-token protector (`AUTH_ID_TOKEN_AT_REST_UNENCRYPTED`, `create-adapter.ts:119-121`).
- The ID token is sealed by our adapter (F19). Nothing new is stored.
- Tokens are decrypted only inside the action that needs them.
- The docs forbid returning the token to the browser, logging it, or passing it to scheduled
  functions as an argument. Scheduled arguments are stored.
- The helper works only in actions (F28). It refuses mutations and queries with
  `AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION`.
- The audience of the access token is configured at the IdP. For Keycloak: a _default_ client scope
  with an audience mapper for each internal service. The internal service must check `aud`.

## 6. File layout and build slices

### 6.1 Files

New files go under `src/runtime/convex-auth/` unless a path says otherwise.

| File                                                                             | New/changed    | Owner slice   | Content                                                                                                                          |
| -------------------------------------------------------------------------------- | -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `oidc-options.ts`                                                                | new            | S1            | types 2.1, exported constants 2.2, `resolveOidcConfig`, `isAllowedIdpUrl`                                                        |
| `oidc-fetch.ts`                                                                  | new            | S1            | `oidcDeadline`, `idpFetch`, `readBodyCapped`, `OidcError`                                                                        |
| `oidc-metadata.ts`                                                               | new            | S1            | discovery and JWKS cache, failure backoff, `verifyJwt`, `requestTokens`, `accountKey`, `getOidcClient`                           |
| `diagnostics.ts`                                                                 | changed        | S1            | `AUTH_CONFIG_OIDC_INVALID` sub-code, `logOidcFailure`                                                                            |
| `package.json`, `pnpm-lock.yaml`                                                 | changed        | S1            | `jose: 6.2.3` moved to `dependencies`                                                                                            |
| `test/helpers/fake-oidc-idp.ts`                                                  | new            | S1            | fake IdP at `fetch` (6.3)                                                                                                        |
| `oidc-provider.ts`                                                               | new            | S2            | `createOidcProvider`, `isOwnedOidcProvider`                                                                                      |
| `oidc-backchannel-logout.ts`                                                     | new            | S3            | `handleOidcBackchannelLogout`                                                                                                    |
| `oidc-upstream.ts`                                                               | new            | S4            | `createOidcUpstream`                                                                                                             |
| `oidc-plugin.ts`                                                                 | new            | S5a           | `createOidcPlugin` (3.10), both database guards, `endGrant`, `swapTokens`, `open`                                                |
| `create-better-convex-auth.ts`                                                   | changed        | S5a, then S5b | S5a: option, validation, twoFactor and trustedProviders rules, wiring, invariant. S5b: `beforeMint` wiring, `getOidcAccessToken` |
| `index.ts`                                                                       | changed        | S5a           | export the types `BetterConvexOidcOptions` and `BetterConvexOidcAccessToken`                                                     |
| `plugin.ts`                                                                      | changed        | S5b           | `beforeMint` option and line                                                                                                     |
| `test/mutants/mutants.ts`                                                        | changed        | S5b           | all rows from section 7 (one writer)                                                                                             |
| `.changeset/oidc-sign-in.md`                                                     | new            | S5b           | section 8.4                                                                                                                      |
| `test/integration/oidc-keycloak.integration.test.ts`                                              | new            | S6a           | real Keycloak suite                                                                                                              |
| `test/fixtures/keycloak/docker-compose.yml`, `test/fixtures/keycloak/realm.json` | new            | S6a           | Keycloak pinned by digest, test realm with the client from 8.1                                                                   |
| `.github/workflows/ci.yml`                                                       | changed        | S6a           | Keycloak steps in the `integration` job                                                                                          |
| `test/TESTING.md`                                                                | changed        | S6a           | how to run the Keycloak suite                                                                                                    |
| docs, `internals/decisions.md`, `scripts/agent-docs.mjs`, `.github/SECURITY.md`  | changed or new | S6b           | section 8                                                                                                                        |

### 6.2 Slices

**Order and parallelism.** S1 runs first. Then S2, S3 and S4 run in parallel; their files are
disjoint and each depends only on S1. Then S5a, then S5b (both edit `cba`, one after the other).
Then S6a and S6b run in parallel; their files are disjoint. Both copy the Keycloak client JSON from
section 8.1, which is its single source.

**One-time setup per worktree:**

```bash
pnpm install && pnpm --filter './packages/*' build && pnpm exec nuxt-module-build prepare
```

**Every slice also passes these** (on its own files):

```bash
pnpm exec eslint <files>
pnpm exec oxfmt --check <files>
node scripts/check-boundaries.mjs
```

Each test file uses literal expected values. Fault cases are tables (`it.each` with a `name` column,
test title `'<verb> $name'`). The tests reach the network only through the fake IdP. Time is
controlled with `vi.useFakeTimers()`; production code has no clock or sleep parameters.

#### S1: core (options, fetch, discovery, keys, token requests, fake IdP)

Acceptance:

```bash
pnpm exec vitest run --project=unit test/unit/oidc-options.test.ts test/unit/oidc-fetch.test.ts test/unit/oidc-metadata.test.ts
pnpm typecheck
```

Tests. Each entry names the realistic wrong behaviour it catches.

- `test/unit/oidc-options.test.ts`, `describe('OIDC options')`:
  - `rejects $name` (table). Catches a misconfiguration that slips through, or a message that leaks
    the secret. Cases:
    - `http issuer on a public host`
    - `issuer with query`
    - `issuer with fragment`
    - `issuer with credentials`
    - `empty client id`
    - `empty client secret`
    - `unknown key`
    - `scopes key` (expects `does not support "oidc.scopes"`)

    Each case asserts the exact message from 2.3. It also asserts that the message does not
    contain the configured secret `s3cret-value`.

  - `accepts $name`. Cases: `https issuer`, `http on 127.0.0.1`, `http on localhost`, `http on [::1]`.
    Catches a loopback dev setup that gets refused.
- `test/unit/oidc-fetch.test.ts`, `describe('OIDC fetch')`:
  - `refuses $name`. Cases: `302 redirect`, `307 redirect`, `opaque redirect`. Catches SSRF through
    an IdP redirect.
  - `refuses a body over the limit without Content-Length`. Catches unbounded memory from a hostile
    endpoint.
  - `refuses a Content-Length over the limit before reading`.
  - `times out at the deadline`. Uses fake timers. Catches a hung IdP that pins an action.
- `test/unit/oidc-metadata.test.ts`, `describe('OIDC discovery and keys')`:
  - `rejects a document whose issuer differs from the configured issuer`. Also asserts that the
    log line carries `expected` and `received`. Catches mix-up and misbinding, and an undebuggable
    mismatch.
  - `rejects discovery with $name`. Cases:
    - `token_endpoint on http`
    - `token_endpoint on http on a public host with a loopback http issuer`
    - `jwks_uri with credentials`
    - `no S256 in code_challenge_methods_supported`
    - `only HS256 advertised`
    - `none advertised`
    - `no supported token auth method`
  - `uses the advertised algorithms in our order`.
  - `does not fetch again within 10 s after a discovery failure`. Fake timers. Catches a retry storm
    against a failing IdP that also pins actions.
  - `retries discovery after the backoff`. Catches a cached transient outage that blocks sign-in
    until the isolate dies.
  - `verifies a valid id_token`.
  - `rejects a token $name`. Cases:
    - `signed with RS384 when only RS256 is advertised` → `algorithm`
    - `with alg HS256` → `algorithm`, and no JWKS fetch
    - `from another issuer` → `issuer`
    - `for another audience` → `audience`
    - `with azp of another client` → `azp`
    - `with two audiences and no azp` → `azp`
    - `expired` → `expired`
    - `issued 11 minutes ago` → `too_old`
    - `issued 2 minutes in the future` → `not_yet_valid`
    - `with typ at+jwt` → `typ`
    - `tampered payload` → `signature`
    - `over 16 KiB` → `too_large`
    - `with a header that is not JSON` → `malformed`

    Each case asserts the exact `reason`, and that `verifyJwt` resolves (never throws).

  - `refetches the key set once for an unknown kid after the cooldown`. Catches a rotated IdP key
    that locks everyone out.
  - `fetches JWKS at most once per 30 s for unknown kids and answers keys_unavailable`. Catches an
    attacker-driven JWKS flood, and a valid post-rotation token answered as a bad signature.
  - `gives another account key for the same sub at another issuer`. Catches an account key without
    the issuer.
  - `sends client_secret_basic by default and client_secret_post when only that is advertised`.
  - `returns the error code of a 400 token response`.
  - `never logs the client secret`. Runs a discovery failure, a 401 token response and a transport
    failure, and asserts that no `console.error` argument contains the secret.

#### S2: provider and sign-in

Acceptance:

```bash
pnpm exec vitest run --project=unit test/unit/oidc-provider.test.ts
pnpm typecheck
```

Tests in `test/unit/oidc-provider.test.ts`, `describe('OIDC provider')`. They call the provider
methods directly against the fake IdP.

- `builds an authorization URL with S256, nonce, state and the fixed scopes`.
- `ignores scopes, loginHint and additionalParams from the client`. Catches a client widening the
  scopes or injecting `prompt=none`.
- `exchanges the code with the verifier and client_secret_basic`.
- `throws when the token response has no id_token`. Catches the userinfo fallback.
- `returns the verified profile for a valid id_token and nonce`.
- `rejects an id_token whose nonce differs`. Catches a replayed or injected ID token.
- `returns null without an expected nonce`. Catches `/account-info` and id-token sign-in using
  `getUserInfo` unbound.
- `maps email_verified $name`. Cases:
  - `true` → `true`
  - `"true"` → `false`
  - `absent` → `false`
  - `1` → `false`

  Catches an unverified address treated as verified.

- `uses the issuer-tagged sub as the account subject`.
- `builds the end-session URL with client_id, id_token_hint, post_logout_redirect_uri and state`.
- `returns null when discovery has no end_session_endpoint`.
- `answers SERVICE_UNAVAILABLE OIDC_UNAVAILABLE when discovery fails`.
- `is frozen`. Asserts that writing `provider.options.disableIdTokenSignIn` throws. Catches a
  shallow freeze that lets another plugin reopen a door.

#### S3: back-channel logout

Acceptance:

```bash
pnpm exec vitest run --project=unit test/unit/oidc-backchannel-logout.test.ts
pnpm typecheck
```

Tests in `test/unit/oidc-backchannel-logout.test.ts`, `describe('OIDC back-channel logout')`. Keys
come from the fake IdP. `consume` is a table stub that returns scripted decisions. The other
dependencies are recording stubs.

- `ends the grant of the user found by sub`. Asserts `endGrant` got that user.
- `answers 200 and ends nothing for an unknown sub`.
- `accepts a logout token with two audiences and no azp`. Catches the ID-token `azp` rule applied
  to logout tokens.
- `rejects $name` (400, and nothing ended). Cases:
  - `a logout token without the back-channel event`
  - `a logout token with a nonce`
  - `a sid-only logout token`
  - `a logout token issued more than 5 minutes ago`
  - `a logout token issued more than 60 s in the future`
  - `a logout token for another audience`
  - `a logout token from another issuer`
  - `typ at+jwt`
  - `an id_token`
  - `two logout_token parameters`
  - `a JSON body`
  - `a body over 16 KiB`
  - `a replayed jti`

  Each catches the matching forged or confused-token logout. The `an id_token` case catches an
  attacker who reuses a captured ID token as a logout trigger.

- `rejects an HS256 logout token without fetching keys`. Catches unauthenticated requests that
  make the server fetch.
- `answers 405 for GET`.
- `answers 503 when the keys cannot be fetched`.
- `answers 503 for an unknown kid inside the key cooldown`. Catches a lost logout after a key
  rotation.
- `answers 500 when ending the grant fails`.

#### S4: upstream tokens and liveness

Acceptance:

```bash
pnpm exec vitest run --project=unit test/unit/oidc-upstream.test.ts
pnpm typecheck
```

Tests in `test/unit/oidc-upstream.test.ts`, `describe('OIDC upstream tokens')`. The token endpoint
is the fake IdP. `consume`, the account store (with a real compare-and-swap over a `Map`) and
`endGrant` are small recording stubs. `seal` adds `$ba$` and `open` removes it.

- `returns a fresh token without calling the IdP`.
- `refreshes once and stores the new tokens sealed`.
- `two concurrent refreshes call the token endpoint once`. Catches a refresh-token rotation failure
  that becomes a false logout.
- `the waiting caller gets the winner's token`.
- `invalid_grant ends the grant`. Catches an ended IdP session that keeps the app session alive.
- `does not end the grant when another refresh wrote new tokens`. Catches a fresh sign-in that gets
  logged out.
- `does not overwrite tokens that a sign-in stored during the refresh`. The store changes the
  refresh token between the lease and the write; expects `busy`, the sign-in's tokens kept, and no
  `endGrant`. Catches an old grant that later ends a new IdP session.
- `IdP outage keeps the sessions`. Cases: `timeout`, `500`, `network`. Catches an IdP outage that
  signs everyone out.
- `a timeout after the IdP rotated the token loses the grant, and the next refresh ends it`. The
  fake IdP rotates, then answers after the deadline. Expected: first call `unavailable`, stored
  tokens unchanged, no `endGrant`; after 30 s (lease), the second call gets `invalid_grant` and
  returns `ended` with one `endGrant` call.
- `invalid_client keeps the sessions and logs AUTH_OIDC_CLIENT_REJECTED`.
- `refuses a refreshed id_token for another subject`.
- `drops a refreshed id_token with a bad signature and keeps the old one`.
- `refuses a refresh token stored without encryption`. Expects `unavailable` and no token request.
- `fails closed with two oidc accounts`. Expects `unavailable` and no token request.
- `isGrantLive skips the IdP while the token has more than 60 s left`.
- `isGrantLive does not wait for a busy lease`.
- `the waiting caller waits past the lease holder's deadline`. Fake timers; the holder succeeds at
  9.9 s. Catches a waiter that gives up before the holder finishes.

#### S5a: plugin, factory option, guards, sign-in and back-channel end-to-end

Acceptance:

```bash
pnpm exec vitest run --project=unit test/unit/auth-oidc-config.test.ts
pnpm exec vitest run --project=convex test/convex/auth-oidc.test.ts
pnpm typecheck
```

Tests in `test/unit/auth-oidc-config.test.ts`, `describe('OIDC configuration')`:

- `rejects twoFactor together with oidc`.
- `rejects socialProviders.oidc`.
- `rejects oidc in trustedProviders`. With and without the `oidc` option.
- `accepts the function form without calling it at module load`. Catches a crash on the first
  `convex dev` push.

Tests in `test/convex/auth-oidc.test.ts`. Use the harness shape of
`auth-identity-safe-defaults.test.ts:22-200`, with the fake IdP installed, `createBetterConvexAuth`
with `oidc`, and calls through `registerRoutes`. Any test that checks `callbackURL` or CSRF sets
`advanced.disableOriginCheck: false` and `advanced.disableCSRFCheck: false` through the owned test
factory, following `auth-site-origins.test.ts` (F35).

`describe('OIDC sign-in with real Better Auth')`:

- `signs in a verified user and stores encrypted tokens`. Asserts the `$ba$` prefix on all three
  tokens and `accountId === <issuer tag>:<sub>`.
- `refuses an unverified email and creates no user`.
- `refuses an existing local user with the same email until linked, then signs in after linkSocial`.
- `refuses client-submitted id_token sign-in`. Expects 404 `ID_TOKEN_NOT_SUPPORTED`.
- `refuses a client-submitted id_token at link-social`. Expects 404 `ID_TOKEN_NOT_SUPPORTED`.
- `refuses a callback with another iss`.
- `refuses a state created for another provider`. Starts a GitHub sign-in, replays its state at
  `/callback/oidc`, expects `error=nonce_binding_missing` and no session.
- `keeps the stored email when the IdP email changes`. Catches `overrideUserInfo` sneaking in.
- `keeps ID-token claims out of additional user fields`. Configures an additional user field
  `role` with `input: true`; the ID token carries `role: 'admin'`; the user row has no `role`.
- `a sub from another issuer does not sign in the old account`. Signs in at issuer A, then
  reconfigures to issuer B whose IdP returns the same `sub` and email; expects
  `error=account_not_linked` and no session for the old user.
- `builds Better Auth inside a mutation without fetching`. Uses `getAuth` in `test.mutation`, and
  the fetch counter stays 0. Catches eager discovery that breaks mutations.
- `resolves discovery once across sign-ins`. Catches a new client per auth construction.
- `sign-in answers 503 OIDC_UNAVAILABLE while discovery fails and works after the backoff`.
- `rejects a second provider named oidc from another plugin`. Passes a foreign provider through
  `createBetterConvexAuthOwned`'s `extraPlugins`, and expects `AUTH_CONFIG_INVALID`.
- `sign-out returns the IdP end-session URL`.
- `uses each site origin for redirect_uri and post_logout_redirect_uri`. With `siteOrigins`, a
  sign-in on the second origin sends that origin's `redirect_uri` in the authorization request and
  in the token request, and sign-out returns that origin's `post_logout_redirect_uri`.

`describe('OIDC doors and linking with real Better Auth')`:

- `a linked user cannot sign in with a password`. Expects 403 `OIDC_SIGN_IN_REQUIRED` and no
  session.
- `a linked user cannot sign in with an email code`. Same expectation.
- `an unlinked password user still signs in with a password`. Catches a guard that closes every
  door for everyone.
- `refuses linking a second identity-provider account`. A user linked to `sub1` links `sub2`;
  expects the link refused and one `oidc` account.

`describe('OIDC back-channel logout with real Better Auth')`:

- `ends every session and blocks token mint`. Two sessions; after logout, `getUser` is `null` and
  `/convex/token` answers 401.
- `clears the stored IdP tokens`. After logout, the account has no access, refresh or ID token.
- `reaches the route without Origin or cookies`.
- `rejects a replayed logout token across requests`. Uses the real `consumeRateLimit`.
- `does not end sessions of a user whose github account has the same id`. Inserts an account row
  `{ providerId: 'github', accountId: <the oidc account key> }` for another user.

#### S5b: liveness, upstream helper, mutants, changeset

Acceptance:

```bash
pnpm exec vitest run --project=convex test/convex/auth-oidc-upstream.test.ts
for id in $(node -e "import('./test/mutants/mutants.ts').then(m=>console.log(m.mutants.filter(r=>r.guards==='oidc').map(r=>r.id).join(' ')))"); do pnpm test:mutants --only "$id" || exit 1; done
pnpm verify
```

If importing `mutants.ts` from `node -e` fails, list the ids by hand.

Tests in `test/convex/auth-oidc-upstream.test.ts`, `describe('OIDC upstream tokens with real Better Auth')`,
same harness as S5a:

- `getOidcAccessToken returns a stored fresh token`.
- `getOidcAccessToken refreshes once for two concurrent actions`.
- `getOidcAccessToken after invalid_grant throws OIDC_SIGN_IN_REQUIRED and ends sessions`.
- `refuses getOidcAccessToken from a mutation`.
- `getOidcAccessToken without a session throws UNAUTHENTICATED`. Kills the `requireUser` mutant in
  our own call site.
- `never returns another provider's token`. The user also has a GitHub account with tokens; the
  helper returns the `oidc` token.
- `refuses a refresh token stored without encryption`. A plaintext refresh token written into the
  account gives `OIDC_UNAVAILABLE` and no token request.
- `a refresh does not overwrite tokens from a newer sign-in`. The fake IdP's token endpoint, while
  answering the refresh, runs a sign-in for the same user first; the stored tokens are the
  sign-in's.
- `auth.api.getAccessToken cannot refresh the oidc account`. With an expired stored token, the call
  throws, the token endpoint gets no request, and the account is unchanged.
- `ended IdP grant blocks token mint`. Expire the stored token, have the fake IdP answer
  `invalid_grant`, and expect `/convex/token` 401 with the sessions ended and the tokens cleared.
- `IdP outage does not block token mint`.

Mutant rows: every row of section 7, written in one pass. Changeset: section 8.4.

#### S6a: Keycloak suite and CI

Acceptance:

```bash
docker compose -f test/fixtures/keycloak/docker-compose.yml up -d --wait
BCN_TEST_KEYCLOAK_URL=http://127.0.0.1:18080 pnpm exec vitest run --project=convex test/integration/oidc-keycloak.integration.test.ts
pnpm exec vitest run --project=convex test/integration/oidc-keycloak.integration.test.ts   # skips without the variable
pnpm lint
docker compose -f test/fixtures/keycloak/docker-compose.yml down -v
```

**Fixture.** Based on the spike's files, with these changes:

- The realm is `better-convex-test`, with `revokeRefreshToken: true`, `refreshTokenMaxReuse: 0`
  (rotation is always tested) and `accessTokenLifespan: 300`. Tests that need a refresh set the
  stored `accessTokenExpiresAt` to the past instead of using short tokens.
- The client is the JSON from 8.1 with: `clientId` `better-convex`, secret
  `test-client-secret-not-for-production`, redirect URI
  `https://app.example.test/api/auth/callback/oidc`, post-logout URI
  `https://app.example.test/signed-out`, back-channel URL
  `http://host.docker.internal:18081/api/auth/oidc/backchannel-logout`. Compose sets
  `extra_hosts: ['host.docker.internal:host-gateway']`.
- Compose sets `KC_HOSTNAME: http://127.0.0.1:18080`, so the issuer is fixed.
- The image is `quay.io/keycloak/keycloak:26.4.<patch>@sha256:<digest>`. Read the digest with
  `docker buildx imagetools inspect`.
- The users are `alice` (verified) and `bob` (unverified). Passwords are test-only.

**Suite.** `describe.skipIf(!process.env.BCN_TEST_KEYCLOAK_URL)`. A small Node HTTP server on
`127.0.0.1:18081` forwards Keycloak's back-channel POST into the convex-test route handler. Tests:

- `signs in alice through Keycloak with PKCE`. Also asserts that the callback carried `iss` and
  that BA compared it.
- `refuses bob (unverified)`.
- `Keycloak admin logout ends the app sessions through back-channel logout`. It asserts the real
  logout token has `sub`, `events` and no `nonce`, and checks `typ`.
- `sign-out follows the Keycloak end-session URL to the post-logout URI`.
- `getOidcAccessToken refreshes under refresh-token rotation for two concurrent actions`.
- `disabled user at Keycloak ends the app session at the next token mint`.
- `logout tokens replayed from Keycloak are refused`.

**CI.** In `.github/workflows/ci.yml`, job `integration`, add these steps after
`pnpm test:integration`:

```yaml
- run: docker compose -f test/fixtures/keycloak/docker-compose.yml up -d --wait
- run: pnpm exec nuxt-module-build prepare
- run: pnpm exec vitest run --project=convex test/integration/oidc-keycloak.integration.test.ts
  env:
    BCN_TEST_KEYCLOAK_URL: http://127.0.0.1:18080
```

No new permissions and no new actions are needed. `test/TESTING.md` gets the suite command.

#### S6b: docs, decision record, agent docs, SECURITY.md

Acceptance:

```bash
pnpm build      # agent-docs table and links resolve
pnpm lint
```

Content: section 8. S6b checks two facts in the installed sources before it writes them, and
changes the text if they differ: the client call shape of 2.5 against the `better-auth/vue` types,
and the Convex CLI flag for a local deployment (`npx convex dev --local`) in
`node_modules/convex/dist/cli.bundle.cjs`. It confirms each callback error string of 8.1 §4 in
`BA/oauth2/errors.mjs`.

### 6.3 Fake IdP (`test/helpers/fake-oidc-idp.ts`, S1)

It is an external-service fake at `fetch`, which test rule 7 of the plan allows. It may use only
web APIs and `jose`, because it runs in the `node` and `edge-runtime` projects.

```ts
export interface FakeIdp {
  readonly issuer: string // unique per fake: 'https://idp.example.test/realms/<random>'
  readonly clientId: string // 'better-convex'
  readonly clientSecret: string // 'test-client-secret'
  readonly requests: Array<{
    url: string
    method: string
    headers: Headers
    body: URLSearchParams | null
  }>
  discovery: Record<string, unknown> // mutable per test
  respond: Partial<
    Record<'discovery' | 'jwks' | 'token', (request: Request) => Response | Promise<Response>>
  >
  issueCode(input: {
    nonce: string
    codeChallenge: string
    redirectURI: string
    claims?: Record<string, unknown>
  }): string
  signIdToken(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>
  signLogoutToken(
    claims?: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Promise<string>
  rotateKey(): Promise<void>
  install(): () => void // vi.stubGlobal('fetch'); passes other URLs to the real fetch
}
export function createFakeIdp(options?: {
  issuer?: string
  algorithm?: 'RS256' | 'ES256'
}): Promise<FakeIdp>
```

The issuer is unique per fake, so the per-isolate caches never need a reset between tests.

The default token endpoint does three things:

- It checks `client_secret_basic` (or `client_secret_post` when discovery says so).
- For `authorization_code`, it checks the S256 verifier against the stored challenge and the
  `redirect_uri` against the one in `issueCode`. It returns an access token, a refresh token
  (rotated on each refresh) and an ID token with the stored nonce.
- For `refresh_token`, it answers `invalid_grant` for an unknown or used refresh token.

## 7. Mutant rows

All rows use `guards: 'oidc'`. Each `find` is a line that the slices **must** write exactly once in
the named file (the lines from sections 2-5). Projects:

- `unit` for `test/unit` kills;
- `convex` for `test/convex` kills;
- both when kills come from both.

The paths are short here. In the rows, `file` is `src/runtime/convex-auth/<name>`. A kill named
`oidc-*` or `auth-oidc-config` lives in `test/unit/<name>.test.ts`; `auth-oidc` and
`auth-oidc-upstream` live in `test/convex/<name>.test.ts`. Write each kill as
`<file> > <describe> > <test>`; `…` stands for the describe name of the same file given in 6.2.

| id                                  | file                           | find                                                                                                                                                                                                                            | replace                                                                                                | kills                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oidc-issuer-equality`              | `oidc-metadata.ts`             | `if (document.issuer !== config.issuer) throw new OidcError('AUTH_OIDC_ISSUER_MISMATCH')`                                                                                                                                       | `if (false) throw new OidcError('AUTH_OIDC_ISSUER_MISMATCH')`                                          | `oidc-metadata > OIDC discovery and keys > rejects a document whose issuer differs from the configured issuer`                                                                                    |
| `oidc-https-only`                   | `oidc-options.ts`              | `return allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)`                                                                                                                                      | `return url.protocol === 'http:'`                                                                      | `oidc-options > OIDC options > rejects http issuer on a public host`; `oidc-metadata > … > rejects discovery with token_endpoint on http on a public host with a loopback http issuer`            |
| `oidc-idp-url-credentials`          | `oidc-options.ts`              | `if (url.username !== '' \|\| url.password !== '' \|\| url.hash !== '') return false`                                                                                                                                           | `if (false) return false`                                                                              | `oidc-options > … > rejects issuer with credentials`; `oidc-metadata > … > rejects discovery with jwks_uri with credentials`                                                                      |
| `oidc-no-redirect`                  | `oidc-fetch.ts`                | `if (response.type === 'opaqueredirect' \|\| REDIRECT_STATUSES.has(response.status)) throw new OidcError('AUTH_OIDC_TRANSPORT', 'redirect')`                                                                                    | `if (false) throw new OidcError('AUTH_OIDC_TRANSPORT', 'redirect')`                                    | `oidc-fetch > OIDC fetch > refuses 302 redirect`                                                                                                                                                  |
| `oidc-follow-redirect`              | `oidc-fetch.ts`                | `redirect: 'manual',`                                                                                                                                                                                                           | `redirect: 'follow',`                                                                                  | `oidc-fetch > OIDC fetch > refuses 302 redirect`                                                                                                                                                  |
| `oidc-size-limit`                   | `oidc-fetch.ts`                | `if (received > limits.maxBytes) throw new OidcError('AUTH_OIDC_TRANSPORT', 'too_large')`                                                                                                                                       | `if (false) throw new OidcError('AUTH_OIDC_TRANSPORT', 'too_large')`                                   | `oidc-fetch > OIDC fetch > refuses a body over the limit without Content-Length`                                                                                                                  |
| `oidc-fetch-deadline`               | `oidc-fetch.ts`                | `const timer = setTimeout(() => fail(new OidcError('AUTH_OIDC_TRANSPORT', 'timeout')), Math.max(0, limits.deadline - Date.now()))`                                                                                              | `const timer = setTimeout(() => fail(new OidcError('AUTH_OIDC_TRANSPORT', 'timeout')), 2_147_483_647)` | `oidc-fetch > OIDC fetch > times out at the deadline`                                                                                                                                             |
| `oidc-discovery-s256`               | `oidc-metadata.ts`             | `if (pkceMethods !== undefined && !pkceMethods.includes('S256')) throw invalid('pkce')`                                                                                                                                         | `if (false) throw invalid('pkce')`                                                                     | `oidc-metadata > … > rejects discovery with no S256 in code_challenge_methods_supported`                                                                                                          |
| `oidc-alg-allow-list`               | `oidc-metadata.ts`             | `const algorithms = OIDC_ALLOWED_ALGORITHMS.filter((alg) => advertised.includes(alg))`                                                                                                                                          | `const algorithms = advertised`                                                                        | `oidc-metadata > … > rejects discovery with only HS256 advertised`; `… > rejects discovery with none advertised`                                                                                  |
| `oidc-jwt-static-alg`               | `oidc-metadata.ts`             | `if (!OIDC_ALLOWED_ALGORITHMS.includes(header.alg)) return { ok: false, reason: 'algorithm' }`                                                                                                                                  | `if (false) return { ok: false, reason: 'algorithm' }`                                                 | `oidc-metadata > … > rejects a token with alg HS256`; `oidc-backchannel-logout > OIDC back-channel logout > rejects an HS256 logout token without fetching keys`                                  |
| `oidc-jwt-algorithms`               | `oidc-metadata.ts`             | `algorithms: metadata.algorithms,`                                                                                                                                                                                              | `algorithms: undefined,`                                                                               | `oidc-metadata > … > rejects a token signed with RS384 when only RS256 is advertised`                                                                                                             |
| `oidc-jwt-issuer`                   | `oidc-metadata.ts`             | `issuer: client.config.issuer,`                                                                                                                                                                                                 | `issuer: undefined,`                                                                                   | `oidc-metadata > … > rejects a token from another issuer`; `oidc-backchannel-logout > … > rejects a logout token from another issuer`                                                             |
| `oidc-jwt-audience`                 | `oidc-metadata.ts`             | `audience: client.config.clientId,`                                                                                                                                                                                             | `audience: undefined,`                                                                                 | `oidc-metadata > … > rejects a token for another audience`; `oidc-backchannel-logout > … > rejects a logout token for another audience`                                                           |
| `oidc-jwt-azp`                      | `oidc-metadata.ts`             | `if (check.typ === 'id_token' && payload.azp !== undefined && payload.azp !== client.config.clientId) return { ok: false, reason: 'azp' }`                                                                                      | `if (false) return { ok: false, reason: 'azp' }`                                                       | `oidc-metadata > … > rejects a token with azp of another client`                                                                                                                                  |
| `oidc-jwt-azp-required`             | `oidc-metadata.ts`             | `if (check.typ === 'id_token' && Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp === undefined) return { ok: false, reason: 'azp' }`                                                                        | `if (false) return { ok: false, reason: 'azp' }`                                                       | `oidc-metadata > … > rejects a token with two audiences and no azp`                                                                                                                               |
| `oidc-jwt-max-age`                  | `oidc-metadata.ts`             | `maxTokenAge: check.maxTokenAgeSeconds,`                                                                                                                                                                                        | `maxTokenAge: undefined,`                                                                              | `oidc-metadata > … > rejects a token issued 11 minutes ago`; `oidc-backchannel-logout > … > rejects a logout token issued more than 5 minutes ago`                                                |
| `oidc-jwks-cooldown`                | `oidc-metadata.ts`             | `if (now - keys.fetchedAt < OIDC_JWKS_REFETCH_COOLDOWN_MS) return null`                                                                                                                                                         | `if (false) return null`                                                                               | `oidc-metadata > … > fetches JWKS at most once per 30 s for unknown kids and answers keys_unavailable`                                                                                            |
| `oidc-jwks-cooldown-unavailable`    | `oidc-metadata.ts`             | `if (!refreshed) return { ok: false, reason: 'keys_unavailable' }`                                                                                                                                                              | `if (!refreshed) return { ok: false, reason: 'signature' }`                                            | `oidc-backchannel-logout > … > answers 503 for an unknown kid inside the key cooldown`                                                                                                            |
| `oidc-failure-backoff`              | `oidc-metadata.ts`             | `if (failure && Date.now() < failure.until) throw failure.error`                                                                                                                                                                | `if (false) throw failure.error`                                                                       | `oidc-metadata > … > does not fetch again within 10 s after a discovery failure`                                                                                                                  |
| `oidc-discovery-failure-not-cached` | `oidc-metadata.ts`             | `if (discoveryCache.get(config.issuer) === entry) discoveryCache.delete(config.issuer)`                                                                                                                                         | `void entry`                                                                                           | `oidc-metadata > … > retries discovery after the backoff`                                                                                                                                         |
| `oidc-id-token-typ`                 | `oidc-metadata.ts`             | `if (check.typ === 'id_token' && typ.endsWith('+jwt')) return { ok: false, reason: 'typ' }`                                                                                                                                     | `if (false) return { ok: false, reason: 'typ' }`                                                       | `oidc-metadata > … > rejects a token with typ at+jwt`                                                                                                                                             |
| `oidc-logout-typ`                   | `oidc-metadata.ts`             | `if (check.typ === 'logout_token' && !LOGOUT_TYPES.has(typ)) return { ok: false, reason: 'typ' }`                                                                                                                               | `if (false) return { ok: false, reason: 'typ' }`                                                       | `oidc-backchannel-logout > … > rejects typ at+jwt`                                                                                                                                                |
| `oidc-account-key-issuer`           | `oidc-metadata.ts`             | `` return `${await issuerTag}:${sub}` ``                                                                                                                                                                                        | `return sub`                                                                                           | `oidc-metadata > … > gives another account key for the same sub at another issuer`; `auth-oidc > OIDC sign-in with real Better Auth > a sub from another issuer does not sign in the old account` |
| `oidc-nonce`                        | `oidc-provider.ts`             | `if (typeof claims.nonce !== 'string' \|\| claims.nonce !== tokens.expectedIdTokenNonce) return reject('nonce')`                                                                                                                | `if (false) return reject('nonce')`                                                                    | `oidc-provider > OIDC provider > rejects an id_token whose nonce differs`                                                                                                                         |
| `oidc-fixed-scopes`                 | `oidc-provider.ts`             | `scopes: OIDC_SCOPES,`                                                                                                                                                                                                          | `scopes: [...OIDC_SCOPES, ...(data.scopes ?? [])],`                                                    | `oidc-provider > … > ignores scopes, loginHint and additionalParams from the client`                                                                                                              |
| `oidc-email-verified-strict`        | `oidc-provider.ts`             | `emailVerified: claims.email_verified === true,`                                                                                                                                                                                | `emailVerified: Boolean(claims.email_verified),`                                                       | `oidc-provider > … > maps email_verified "true" → false`, using the exact title `it.each` generates                                                                                               |
| `oidc-no-override-user-info`        | `oidc-provider.ts`             | `overrideUserInfoOnSignIn: false,`                                                                                                                                                                                              | `overrideUserInfoOnSignIn: true,`                                                                      | `auth-oidc > … > keeps the stored email when the IdP email changes`                                                                                                                               |
| `oidc-nonce-required`               | `oidc-provider.ts`             | `requiresIdTokenNonce: true,`                                                                                                                                                                                                   | `requiresIdTokenNonce: false,`                                                                         | `auth-oidc > … > signs in a verified user and stores encrypted tokens`; `auth-oidc > … > refuses a state created for another provider`                                                            |
| `oidc-refresh-delegated`            | `oidc-provider.ts`             | `refreshAccessToken: async () => { throw new OidcError('AUTH_OIDC_REFRESH_DELEGATED') },`                                                                                                                                       | `refreshAccessToken: async (refreshToken) => ({ accessToken: refreshToken }),`                         | `auth-oidc-upstream > OIDC upstream tokens with real Better Auth > auth.api.getAccessToken cannot refresh the oidc account`                                                                       |
| `oidc-two-factor-refused`           | `create-better-convex-auth.ts` | `if ((record.emailOTP !== undefined && record.emailOTP !== false) \|\| hasSocial \|\| record.oidc !== undefined) {`                                                                                                             | `if ((record.emailOTP !== undefined && record.emailOTP !== false) \|\| hasSocial) {`                   | `auth-oidc-config > OIDC configuration > rejects twoFactor together with oidc`                                                                                                                    |
| `oidc-trusted-provider-refused`     | `create-better-convex-auth.ts` | `if (name === OIDC_PROVIDER_ID) throw configError(OIDC_TRUSTED_PROVIDER_MESSAGE)`                                                                                                                                               | `if (false) throw configError(OIDC_TRUSTED_PROVIDER_MESSAGE)`                                          | `auth-oidc-config > … > rejects oidc in trustedProviders` (asserts the exact message)                                                                                                             |
| `oidc-owned-provider-invariant`     | `create-better-convex-auth.ts` | `if (!oidcProviderInvariantHolds(context, oidcConfig)) throw new Error('AUTH_OWNED_INVARIANT_VIOLATED')`                                                                                                                        | `if (false) throw new Error('AUTH_OWNED_INVARIANT_VIOLATED')`                                          | `auth-oidc > … > rejects a second provider named oidc from another plugin`                                                                                                                        |
| `oidc-idp-managed-user-door`        | `oidc-plugin.ts`               | `if (!isOidcCallback(context) && (await hasOidcAccount(session.userId))) throw oidcSignInRequired()`                                                                                                                            | `if (false) throw oidcSignInRequired()`                                                                | `auth-oidc > OIDC doors and linking with real Better Auth > a linked user cannot sign in with a password`; `… > a linked user cannot sign in with an email code`                                  |
| `oidc-one-account-per-user`         | `oidc-plugin.ts`               | `if (account.providerId === OIDC_PROVIDER_ID && (await hasOidcAccount(account.userId))) throw oidcAccountConflict()`                                                                                                            | `if (false) throw oidcAccountConflict()`                                                               | `auth-oidc > OIDC doors and linking … > refuses linking a second identity-provider account`                                                                                                       |
| `oidc-end-grant-sessions`           | `oidc-plugin.ts`               | `await internalAdapter().deleteUserSessions(userId)`                                                                                                                                                                            | `void userId`                                                                                          | `auth-oidc > OIDC back-channel logout with real Better Auth > ends every session and blocks token mint`; `auth-oidc-upstream > … > ended IdP grant blocks token mint`                             |
| `oidc-end-grant-clears-tokens`      | `oidc-plugin.ts`               | `await clearOidcTokens(userId)`                                                                                                                                                                                                 | `void userId`                                                                                          | `auth-oidc > OIDC back-channel logout … > clears the stored IdP tokens`                                                                                                                           |
| `oidc-logout-provider-scope`        | `oidc-plugin.ts`               | `findUserIdBySubject: async (sub) => (await internalAdapter().findAccountByKey({ providerId: OIDC_PROVIDER_ID, accountId: await client.accountKey(sub) }))?.userId ?? null,`                                                    | same line with `providerId: 'github'`                                                                  | `auth-oidc > OIDC back-channel logout … > does not end sessions of a user whose github account has the same id`                                                                                   |
| `oidc-account-provider-filter`      | `oidc-plugin.ts`               | `const accounts = (await internalAdapter().findAccounts(userId)).filter((account) => account.providerId === OIDC_PROVIDER_ID)`                                                                                                  | `const accounts = await internalAdapter().findAccounts(userId)`                                        | `auth-oidc-upstream > … > never returns another provider's token`                                                                                                                                 |
| `oidc-refresh-cas-store`            | `oidc-plugin.ts`               | `swapTokens: async (id, expectedRefreshToken, patch) => (await ctx.adapter.update({ model: 'account', where: [{ field: 'id', value: id }, { field: 'refreshToken', value: expectedRefreshToken }], update: patch })) !== null,` | same line with `where: [{ field: 'id', value: id }]`                                                   | `auth-oidc-upstream > … > a refresh does not overwrite tokens from a newer sign-in`                                                                                                               |
| `oidc-open-requires-envelope`       | `oidc-plugin.ts`               | `if (!sealed.startsWith('$ba$')) throw new OidcError('AUTH_OIDC_REFRESH_FAILED', 'decrypt')`                                                                                                                                    | `if (false) throw new OidcError('AUTH_OIDC_REFRESH_FAILED', 'decrypt')`                                | `auth-oidc-upstream > … > refuses a refresh token stored without encryption`                                                                                                                      |
| `oidc-logout-events`                | `oidc-backchannel-logout.ts`   | `if (!isPlainRecord(events) \|\| !isPlainRecord(events[BACKCHANNEL_LOGOUT_EVENT])) return invalid('events')`                                                                                                                    | `if (false) return invalid('events')`                                                                  | `oidc-backchannel-logout > … > rejects a logout token without the back-channel event`                                                                                                             |
| `oidc-logout-no-nonce`              | `oidc-backchannel-logout.ts`   | `if ('nonce' in payload) return invalid('nonce')`                                                                                                                                                                               | `if (false) return invalid('nonce')`                                                                   | `oidc-backchannel-logout > … > rejects a logout token with a nonce`                                                                                                                               |
| `oidc-logout-sub-required`          | `oidc-backchannel-logout.ts`   | `if (typeof payload.sub !== 'string' \|\| payload.sub.length === 0) return invalid('sub')`                                                                                                                                      | `if (false) return invalid('sub')`                                                                     | `oidc-backchannel-logout > … > rejects a sid-only logout token`                                                                                                                                   |
| `oidc-logout-replay`                | `oidc-backchannel-logout.ts`   | `if (!replay.allowed) return invalid('replay')`                                                                                                                                                                                 | `if (false) return invalid('replay')`                                                                  | `oidc-backchannel-logout > … > rejects a replayed jti`; `auth-oidc > OIDC back-channel logout … > rejects a replayed logout token across requests`                                                |
| `oidc-logout-body-limit`            | `oidc-backchannel-logout.ts`   | `const body = await readBodyCapped(request, OIDC_LOGOUT_MAX_BODY_BYTES)`                                                                                                                                                        | `const body = await readBodyCapped(request, Number.MAX_SAFE_INTEGER)`                                  | `oidc-backchannel-logout > … > rejects a body over 16 KiB`                                                                                                                                        |
| `oidc-logout-ends-grant`            | `oidc-backchannel-logout.ts`   | `await deps.endGrant(userId)`                                                                                                                                                                                                   | `void userId`                                                                                          | `oidc-backchannel-logout > … > ends the grant of the user found by sub`; `auth-oidc > OIDC back-channel logout … > ends every session and blocks token mint`                                      |
| `oidc-refresh-lease`                | `oidc-upstream.ts`             | `if (!lease.allowed) return { kind: 'busy' }`                                                                                                                                                                                   | `if (false) return { kind: 'busy' }`                                                                   | `oidc-upstream > OIDC upstream tokens > two concurrent refreshes call the token endpoint once`                                                                                                    |
| `oidc-invalid-grant-ends`           | `oidc-upstream.ts`             | `if (!result.ok && result.error === 'invalid_grant') return await endGrantIfUnchanged(current)`                                                                                                                                 | `if (false) return await endGrantIfUnchanged(current)`                                                 | `oidc-upstream > … > invalid_grant ends the grant`; `auth-oidc-upstream > … > ended IdP grant blocks token mint`                                                                                  |
| `oidc-outage-fails-open`            | `oidc-upstream.ts`             | `return unavailable('transport')`                                                                                                                                                                                               | `return await endGrantIfUnchanged(current)`                                                            | `oidc-upstream > … > IdP outage keeps the sessions timeout` (plus the `500` and `network` titles)                                                                                                 |
| `oidc-changed-token-not-ended`      | `oidc-upstream.ts`             | `if (latest === 'conflict' \|\| latest?.refreshToken !== current.refreshToken) return { kind: 'busy' }`                                                                                                                         | `if (false) return { kind: 'busy' }`                                                                   | `oidc-upstream > … > does not end the grant when another refresh wrote new tokens`                                                                                                                |
| `oidc-refresh-cas`                  | `oidc-upstream.ts`             | `if (!(await deps.swapTokens(current.id, current.refreshToken, patch))) return { kind: 'busy' }`                                                                                                                                | `if (false) return { kind: 'busy' }`                                                                   | `oidc-upstream > … > does not overwrite tokens that a sign-in stored during the refresh`                                                                                                          |
| `oidc-refreshed-subject`            | `oidc-upstream.ts`             | `if (verified.ok && (await client.accountKey(String(verified.payload.sub))) !== current.accountId) return unavailable('subject')`                                                                                               | `if (false) return unavailable('subject')`                                                             | `oidc-upstream > … > refuses a refreshed id_token for another subject`                                                                                                                            |
| `oidc-refreshed-id-token-dropped`   | `oidc-upstream.ts`             | `const idToken = verified.ok ? tokens.idToken : current.idToken`                                                                                                                                                                | `const idToken = tokens.idToken`                                                                       | `oidc-upstream > … > drops a refreshed id_token with a bad signature and keeps the old one`                                                                                                       |
| `oidc-mint-liveness`                | `plugin.ts`                    | `if (options.beforeMint && !(await options.beforeMint({ context: ctx.context, session: persistedSession, user: persistedUser }))) unauthorized()`                                                                               | `if (false) unauthorized()`                                                                            | `auth-oidc-upstream > … > ended IdP grant blocks token mint`                                                                                                                                      |
| `oidc-access-token-action-only`     | `create-better-convex-auth.ts` | `if ('db' in ctx \|\| typeof ctx.runAction !== 'function') throw new TypeError('AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION')`                                                                                                       | `if (false) throw new TypeError('AUTH_OIDC_ACCESS_TOKEN_REQUIRES_ACTION')`                             | `auth-oidc-upstream > … > refuses getOidcAccessToken from a mutation`                                                                                                                             |
| `oidc-access-token-requires-user`   | `create-better-convex-auth.ts` | `const oidcUser = await requireUser(ctx)`                                                                                                                                                                                       | `const oidcUser = (await getUser(ctx)) as BetterConvexAuthUser`                                        | `auth-oidc-upstream > … > getOidcAccessToken without a session throws UNAUTHENTICATED`                                                                                                            |

There are two `equivalents` entries:

- `oidc-id-token-missing-check` in `oidc-provider.ts`.
  - It removes `typeof tokens.idToken !== 'string' ||` from step 1 of `getUserInfo`.
  - Reason: a missing token then fails in `verifyJwt` as `malformed`, and the nonce check fails
    too. The line is defence in depth with no observable change.
- `oidc-id-token-sign-in-closed` in `oidc-provider.ts`.
  - It replaces `disableIdTokenSignIn: true,` with `disableIdTokenSignIn: false,`.
  - Reason: the provider has no `idToken` config and no `verifyIdToken`, so BA 1.7.7 refuses
    id-token sign-in either way (F7). The field is defence in depth against a BA change. The e2e
    tests `refuses client-submitted id_token sign-in` and `… at link-social` still run.

If `oxfmt` wraps one of the lines above, the slice writes it so that the `find` text still matches
exactly once. One option is shorter local names; the other is to change the row in S5b to the
formatted text.

## 8. Docs, decision record, changeset

All docs follow `docs/WRITING.md`: Controlled English, task first, no "why the design is right",
and the approved terms: Session, Convex session token, OAuth access token. Use "identity provider"
on first use, then "IdP".

### 8.1 New page: `docs/content/docs/3.build/3.authentication/17.company-sign-in.md`

Frontmatter:

- `title: Company sign-in (OIDC)`
- `description: Sign in through your company's OpenID Connect identity provider, such as Keycloak, and end app sessions when the provider ends them.`
- `navigation.icon: i-lucide-building-2`

Sections:

1. **Before you start.** You need a confidential OIDC client at the IdP, the env vars, and
   `SITE_URL` and `CONVEX_SITE_URL`.
2. **Set up Keycloak.** Start with the realm settings, then import the client.
   - Realm settings: "Revoke Refresh Token" on; access token lifespan between 2 and 15 minutes
     (default 5); users have verified emails, or "Trust Email" is on for the LDAP or
     identity-provider federation.
   - Server: set `KC_HOSTNAME` to the public URL, so the issuer does not change with the request
     host.
   - Client: import this JSON (Clients → Import client, `kcadm.sh create clients -f`, or your
     Terraform provider). Replace each `<...>` value. It is the single source: the test fixture
     (S6a) uses the same JSON with test values.

     ```json
     {
       "clientId": "<client-id>",
       "name": "<app name>",
       "protocol": "openid-connect",
       "enabled": true,
       "publicClient": false,
       "clientAuthenticatorType": "client-secret",
       "secret": "<generated secret, or omit and copy it from the Credentials tab>",
       "standardFlowEnabled": true,
       "implicitFlowEnabled": false,
       "directAccessGrantsEnabled": false,
       "serviceAccountsEnabled": false,
       "consentRequired": false,
       "frontchannelLogout": false,
       "redirectUris": ["https://<site>/api/auth/callback/oidc"],
       "webOrigins": [],
       "attributes": {
         "pkce.code.challenge.method": "S256",
         "post.logout.redirect.uris": "https://<site>/signed-out",
         "backchannel.logout.url": "https://<deployment>.convex.site/api/auth/oidc/backchannel-logout",
         "backchannel.logout.session.required": "true",
         "backchannel.logout.revoke.offline.tokens": "false",
         "use.refresh.tokens": "true",
         "oauth2.device.authorization.grant.enabled": "false",
         "oidc.ciba.grant.enabled": "false"
       },
       "defaultClientScopes": ["web-origins", "acr", "profile", "roles", "basic", "email"],
       "optionalClientScopes": []
     }
     ```

   - A short list explains each setting of the JSON in user words. Rules stated there: redirect and
     post-logout URIs are **exact URIs, no wildcards**, one per site origin (separate several
     post-logout URIs with `##`); direct access grants and consent stay off.
   - Audience for internal services: a client scope with an "Audience" mapper for each service,
     added to the client as a **default** scope.
3. **Configure the app.** `npx convex env set OIDC_ISSUER|OIDC_CLIENT_ID|OIDC_CLIENT_SECRET`, then
   the `oidc: () => ({ ... requireEnv(...) })` example. The issuer must equal the provider's
   discovery `issuer` exactly. An `AUTH_OIDC_ISSUER_MISMATCH` log line shows `expected` and
   `received`. Warning: the issuer is part of every user's account key; changing it unlinks every
   user (they get `account_not_linked`). Pin it with `KC_HOSTNAME`.
4. **Sign in.** The `client.signIn.social({ provider: 'oidc' })` example, and a table of callback
   errors: `issuer_mismatch`, `invalid_code`, `unable_to_get_user_info`, `account_not_linked`,
   `email_not_found`, `nonce_binding_missing`, user creation refused, and `OIDC_UNAVAILABLE` at
   sign-in start.
5. **Sign out of the app and the IdP.** The 2.5 example with a warning that `disableRedirect: true`
   is required.
6. **Central logout and liveness.** What back-channel logout ends (sessions and stored IdP tokens).
   What the liveness check guarantees, in the words of 4.6: it ends app sessions when the IdP
   refuses the refresh token; on Keycloak that includes an ended SSO session; on Google, Entra and
   Okta (default) an IdP sign-out does not end the refresh token. The bounds: access-token lifetime
   plus 15 minutes for the live checks, plus 30 minutes for raw `ctx.auth.getUserIdentity()`. A
   refresh that times out after the IdP rotated the token signs the user out at the next refresh.
7. **Who may use the app.** `beforeUserCreate` runs only when a user is created; it does not run at
   later sign-ins. To limit later sign-ins, gate the client at Keycloak: copy the browser flow, add
   a conditional sub-flow with "Condition - User Role" (negated, for an app role) and "Deny Access",
   and bind the copy as the client's browser-flow override. Removing the role takes effect at the
   user's next IdP sign-in. To end the user's app sessions now, sign the user out in Keycloak
   (Users → Sessions → Sign out), which sends back-channel logout. Disabling the user in Keycloak
   ends them at the next refresh (4.6).
8. **Call your own services.** The `auth.getOidcAccessToken(ctx)` example in a Convex action that
   calls `fetch(serviceUrl, { headers: { authorization: `Bearer ${accessToken}` } })`. List the
   error codes and the cost (5.2). Add a warning: never return the token to the browser, log it,
   or pass it to scheduled functions. State the 2-minute minimum access-token lifetime.
9. **Move existing password users to the IdP.** In this order:
   - The `client.linkSocial({ provider: 'oidc' })` example, and the rule that the emails must match
     and the IdP must mark the email verified.
   - A copy-safe sign-in page snippet that reads `?error=account_not_linked` and tells the person to
     sign in with the old method first and then link.
   - After a link, the user signs in only through the IdP (IdP-managed user); password and email
     code are refused with `OIDC_SIGN_IN_REQUIRED`.
   - Cutover checklist: turn on `oidc`; ask users to link; turn off `emailAndPassword`; keep
     `emailOTP` on until the last user has linked, because it is the only way an unlinked user can
     still sign in and link; then turn `emailOTP` off if the IdP should be the only door.
   - Bulk linking by email is not offered: it would trust an IdP email without proof.
10. **Local development.** Two paths:
    - Local Convex deployment (`npx convex dev --local`) plus a copy of the Keycloak compose file
      from `test/fixtures/keycloak` with `KC_HOSTNAME=http://localhost:18080`. The issuer is
      `http://localhost:18080/realms/<realm>` (http is allowed on loopback). The back-channel URL is
      `http://host.docker.internal:3211/api/auth/oidc/backchannel-logout`, as in the fixture.
    - Cloud dev deployment: it cannot reach `localhost`, so the issuer must be a reachable https
      URL, for example a tunnel or a shared dev realm. Otherwise sign-in fails with
      `AUTH_OIDC_DISCOVERY_FAILED:network`.
11. **Other identity providers.** The requirements:
    - discovery;
    - asymmetric ID-token signatures;
    - `email` and `email_verified: true` in the ID token;
    - refresh tokens for the liveness check;
    - back-channel logout is optional.

    Add the note that Microsoft Entra ID sends no `email_verified`, so it is not supported.

### 8.2 Changed pages

- `1.overview.md`, line 51: add "Company identity provider (OIDC)" to the sign-in methods, with a link.
- `13.better-auth-plugin-support.md`, lines 25-29: name `oidc` with the core options, not as a
  plugin. Note that `genericOAuth` stays rejected.
- `docs/content/docs/1.overview/3.limitations.md`: add a section "Company sign-in supports one OIDC
  provider". It lists:
  - one IdP;
  - no SAML;
  - logout per user, not per IdP session;
  - no front-channel logout;
  - no token exchange;
  - no extra scopes and no `offline_access`;
  - the ID token must carry a verified `email`;
  - HMAC-signed tokens are refused;
  - IdP email changes are not copied;
  - changing the issuer unlinks every user;
  - IdP-managed users have no fallback door while the IdP is down;
  - an unverified password user registered for an employee's address blocks that employee's first
    IdP sign-in until the address owner resets the password and links; turn `emailAndPassword` off
    with `oidc`;
  - the liveness check needs refresh tokens, and on IdPs whose refresh tokens outlive the IdP
    session it does not catch an IdP sign-out;
  - with `session.cookieCache`, BA's own endpoints accept a logged-out session for up to `maxAge`.
- `docs/content/docs/6.operations/6.security-model.md`:
  - under "Trust boundaries", add one paragraph "Company identity provider": what it may decide
    (who signs in, when sessions end), and what it never decides (authorization in Convex);
  - under "Operator responsibilities", add: exact redirect and post-logout URIs with no wildcards,
    the back-channel URL, the client secret, a pinned issuer (`KC_HOSTNAME`), multi-factor sign-in
    at the IdP, the access-token audience, and the access-token lifetime (2-15 minutes).
- `.github/SECURITY.md`:
  - In "Security model", add the bullet "Company sign-in": state, PKCE S256, nonce, verified ID
    token, issuer-bound account keys, IdP-managed users, and back-channel logout are always on. The
    liveness check ends app sessions when the IdP refuses the refresh token.
  - In the incident table, add the row "The OIDC client secret": rotate it at the IdP, set the new
    value with `npx convex env set`, and keep the old secret disabled. A compromised IdP signing key
    is handled at the IdP: rotate it there; the JWKS cache takes it at the next unknown `kid`
    (at most 30 s; in that time logout tokens get 503 and the IdP retries).
- `scripts/agent-docs.mjs`: add the "Start here" row
  `['Sign in through a company identity provider (Keycloak, OIDC)', ['/docs/build/authentication/company-sign-in']]`.

### 8.3 Decision record (`internals/decisions.md`), new lines

- `- D52 (2026-10-21): createBetterConvexAuth signs in through one OpenID Connect provider with the reviewed option "oidc" (id "oidc"), built by the library, not genericOAuth: genericOAuth fetches discovery per request, skips a provider that fails silently, follows redirects and falls back to an unverified userinfo call. Discovery and keys load lazily and are cached per isolate, with a 10 s failure backoff, because Better Auth is also built in mutations, where fetch is not allowed. State, PKCE S256, nonce, a verified ID token and exact issuer equality are always on; the client cannot choose scopes or extra parameters. Accounts are keyed by an issuer tag plus sub, so a new issuer can never inherit accounts. A user with an "oidc" account gets sessions only through the IdP, and "oidc" can never be a trusted linking provider. RFC 9207 iss is checked when present but not required: distinct callback paths per provider already prevent mix-up. Refused with it: twoFactor (sign-in skips the local factor), extra scopes, offline_access, HMAC-signed tokens. SAML, several IdPs, token exchange and per-IdP-session logout wait for a real request.`
- `- D53 (2026-10-21): An ended identity-provider grant ends the app sessions. Back-channel logout (POST /api/auth/oidc/backchannel-logout) ends all sessions of the user found by (oidc, issuer tag:sub), bumps the security generation and clears the stored IdP tokens; per-session logout needs a session column. The Convex token mint refreshes an expiring upstream token: when the IdP refuses the refresh token (revoked grant, disabled user, or an ended SSO session on IdPs that bind refresh tokens to it, such as Keycloak), all sessions of the user end; an unreachable IdP signs nobody out. Many IdPs keep refresh tokens after an IdP sign-out; there only revocation is caught. One owner refreshes upstream tokens (auth.getOidcAccessToken and the mint), serialized by a 30 s lease in the rate-limit table and written with compare-and-swap; Better Auth's own refresh paths are refused for "oidc". The helper ships before three apps use it, because refresh serialization and the meaning of invalid_grant are correctness rules, not convenience.`

### 8.4 Changeset (`.changeset/oidc-sign-in.md`)

```md
---
'@lupinum/better-convex-nuxt': minor
---

Add the `oidc` option to `createBetterConvexAuth` to sign in through your company's OpenID Connect identity provider, such as Keycloak.
A user who signs in through the identity provider, or links it, then signs in only through it.
The identity provider can end app sessions through back-channel logout, and app sessions also end at the next Convex session token refresh when the provider refuses the refresh token.
Add `auth.getOidcAccessToken(ctx)` for Convex actions that call your own services with the user's access token.
Add `jose` as a dependency.
```

## 9. Risks and open questions for the maintainer

### Open questions (need a decision)

- **Q1. Tiered user management.** Does the first requesting team need Keycloak roles or groups inside Convex? This
  design gives Convex only identity. Roles live in the app (for example `organization`), and the
  IdP can refuse sign-in to the client (8.1 §7). Mapping claims needs a stored projection, which is
  a schema change or a user field, and a refresh rule. Recommendation: ask that team before the build.
  It does not block the slices.
- **Q2. Refusing OIDC sign-up only.** `beforeUserCreate` cannot tell which door created the user.
  With `emailAndPassword` also on, an app cannot close OIDC sign-up alone. Recommendation: wait for
  a real request, then pass a `method` field to `beforeUserCreate` (that touches all doors).
- **Q3. Unverified emails at Keycloak.** Users created by an admin have `email_verified: false` by
  default. This design refuses them, the same as the spike's `bob`. The fix is at Keycloak: mark
  the emails verified, or turn on "Trust Email" for LDAP. A `trustEmail` option would weaken the
  core identity rule for every deployment. Recommendation: keep it strict and document it. Confirm
  that this fits the requesting team's realm.
- **Q4. Liveness check with no opt-out.** It changes session semantics: the app session ends when
  the IdP refuses the grant, including Keycloak idle expiry after a closed tab. Recommendation: on,
  with no option, because this is what SSO customers expect. Confirm.
- **Q5. IdP-managed users (new, from security finding M4).** A user with an `oidc` account signs in
  only through the IdP. Consequences: no password or email-code fallback while the IdP is down,
  and `/change-password` of a linked user fails after it has ended the other sessions. The
  alternative (other doors stay open) lets a disabled or departed employee keep access through a
  password or a recycled email address. Recommendation: keep the rule, with no option. Confirm.
- **Q6. Changing the issuer (new, from security finding M1).** The issuer tag in the account key
  makes a changed issuer unlink every user (fail closed). A planned hostname change then needs a
  one-time rewrite of `accountId` for `providerId 'oidc'`. Recommendation: no helper now; document
  "pin the issuer"; add a reviewed operator function (in the style of `jwksOperatorFunctions`) on
  the first real request.
- **Q7. Lost grant after a timeout (new, from security finding M2).** A refresh that times out
  after Keycloak rotated the token loses the grant, and the next refresh signs the user out
  (usually without a password prompt, because the IdP session lives on). Moving the refresh into a
  scheduled action does not remove this, and it needs a new app export plus a function-reference
  option. Recommendation: accept, with the 10 s deadline and the documentation. Confirm.

### Risks (accepted unless you object)

- **R1. Real Convex runtime.** `redirect: 'manual'`, `AbortController`, `crypto.subtle.digest` and
  stream reading in `fetch` run only under convex-test (edge-runtime) in CI. The first real-backend
  run is the manual `pnpm test:live` before release. Add a starter fixture with the `oidc` option
  only if that run fails.
- **R2. A logout can be lost.** This happens when ending the grant fails after the `jti` was
  consumed, or when the rate limit drops a burst (4.5). The liveness check limits the damage where
  the IdP binds refresh tokens to its session (about 20 minutes with Keycloak defaults).
- **R3. Keycloak header `typ`.** This design accepts an absent `typ`, `JWT` or `logout+jwt` for
  logout tokens. The Keycloak suite confirms the real value. If Keycloak 26.4 sends something else,
  S6a changes the rule and S5b's mutant row together.
- **R4. CI time and Docker.** The Keycloak steps add about 1-2 minutes to the `integration` job.
  The image is pinned by digest. GitHub's `ubuntu-24.04` runner ships Docker Compose; S6a confirms
  this on the first CI run.
- **R5. Mint latency during an IdP slowdown.** A mint that refreshes can wait up to 10 s. The
  failure backoff limits this to one mint per isolate per 10 s; the other mints skip the call.
- **R6. Stale profile.** Email and name changes at the IdP are not copied. This is intentional
  (no `overrideUserInfo`) and documented.
- **R7. Frozen provider.** The provider object is deep-frozen. If a later BA version writes to it,
  sign-in throws. The S5a e2e suite would catch it at upgrade time.

## Addressed review findings

Security review (S) and API/simplicity review (A). "Accepted" means the design above changed.

| #     | Finding                                                    | Decision                           | Reason or change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-M1  | Account key ignores the issuer                             | Accepted                           | `accountKey` = 16-char issuer tag + `:` + `sub` (3.2), used by `accountSubject`, the back-channel lookup and the refresh subject check. Mutant `oidc-account-key-issuer`, e2e "a sub from another issuer does not sign in the old account". The migration mutation is not shipped: a changed issuer fails closed with `account_not_linked`; Q6 asks the maintainer, the docs say "pin the issuer".                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S-M2  | Timeout after rotation, then `invalid_grant` ends sessions | Partly accepted                    | Accepted: one 10 s deadline for the whole refresh on both paths (was 3 s on the mint), the documented outcome (4.6, 8.1 §6), and the test "a timeout after the IdP rotated the token loses the grant, and the next refresh ends it" with exact expectations. Rejected: (a) a scheduled `refreshOidcGrant` action. The library cannot schedule a function without a new required app export and a function-reference option, and a scheduled refresh times out after rotation in the same way; it only moves the latency, which the deadline and backoff already bound. (b) The `oidc-refresh-inflight` marker and a separate `AUTH_OIDC_GRANT_LOST` code: they add a second rate-limit key only to relabel a log line; the timeout is already logged as `AUTH_OIDC_REFRESH_FAILED:timeout` before the `GRANT_ENDED` line. Q7 asks the maintainer to confirm. |
| S-M3  | Liveness guarantee overclaimed                             | Accepted                           | Restated in 1, 4.6, 8.1 §6, 8.2, D53, SECURITY.md and the changeset. Bounds: access-token lifetime + 15 min (live checks), + 30 min (raw identity).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-M4  | Other doors bypass an IdP disable or a recycled email      | Accepted                           | `session.create.before` guard: a user with an `oidc` account gets sessions only from `/callback/oidc` (3.8 rule 6), code `OIDC_SIGN_IN_REQUIRED`. Mutant `oidc-idp-managed-user-door`; e2e tests for password and email code, plus "an unlinked password user still signs in". Unlinking the `oidc` row is refused (3.8 rule 7, mutant `oidc-unlink-refused`). Q5 asks for confirmation of the product effect.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-M5  | `trustedProviders: ['oidc']` allows unverified linking     | Accepted                           | Refused with the given message (2.3). Mutant `oidc-trusted-provider-refused`; the accept test and `oidc-trusted-provider-name` row are gone; `resolveTrustedProviders` keeps two parameters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-M6  | Failures not cached; mint latency unbounded                | Partly accepted                    | Accepted: 10 s failure backoff per issuer per isolate for discovery, JWKS and token transport failures (3.2); one deadline per operation (3.3); a static `alg` check before any fetch (3.2 step 3); mutant `oidc-failure-backoff` with its test. Rejected: requiring a `kid` header. OIDC Core 10.1 requires `kid` only when the JWK set has several keys, so a compliant single-key IdP would lose back-channel logout. The backoff and the 30 s refetch cooldown already bound the fetches a forged token can cause.                                                                                                                                                                                                                                                                                                                                       |
| S-m1  | Unknown `kid` in cooldown maps to `signature`              | Accepted                           | Maps to `keys_unavailable` (503 + `Retry-After` for logout). Mutant `oidc-jwks-cooldown-unavailable`, test "answers 503 for an unknown kid inside the key cooldown".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S-m2  | jose reports old `iat` as `JWTExpired`                     | Accepted (verified, F30)           | Error map in 3.2 step 5; tests for `too_old`, `not_yet_valid`, `malformed`, and "never throws".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S-m3  | F15 misleading                                             | Accepted (verified)                | F15 rewritten; every dependency reads `internalAdapter()` at call time (3.10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-m4  | Back-channel logout leaves upstream tokens                 | Accepted                           | One `endGrant` (sessions, then tokens) shared by logout and refresh (3.10). Mutant `oidc-end-grant-clears-tokens`, e2e "clears the stored IdP tokens".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S-m5  | Helper wait shorter than the holder's timeout              | Accepted                           | Waiter polls every 500 ms until deadline + 1 s (5.2); test "the waiting caller waits past the lease holder's deadline".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S-m6  | Refresh write without compare-and-swap                     | Accepted (verified, F37)           | `swapTokens` through the adapter's `updateOne` with a `refreshToken` clause; a lost swap returns `busy`. Mutants `oidc-refresh-cas` and `oidc-refresh-cas-store`, unit and e2e tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S-m7  | `azp` rule applies to logout tokens                        | Accepted                           | Both `azp` lines are guarded by `check.typ === 'id_token'`; test "accepts a logout token with two audiences and no azp".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S-m8  | Short tokens cause refresh churn                           | Accepted in another form           | Merged with A9: one margin (60 s) and a documented minimum lifetime of 2 min (2.2), instead of a margin from the lifetime. Reason: the stored row has no issue time, so `lifetime / 4` would need a new stored value. Churn is bounded anyway by the mint rate and the lease.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S-m9  | `open` accepts plaintext                                   | Accepted (verified, F31)           | `open` requires `$ba$` (3.10). Mutant `oidc-open-requires-envelope`, e2e test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S-m10 | Two `oidc` accounts per user                               | Accepted (verified, F33)           | `account.create.before` guard (3.8 rule 5); `findAccountForUser` returns `'conflict'` and the helper fails closed. Two concurrent link callbacks can both pass the check (check-then-act); accepted because only the user can cause it and it fails closed. Mutant `oidc-one-account-per-user`, unit and e2e tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S-m11 | Squatter blocks IdP sign-in                                | Accepted                           | Documented in 2.4 and limitations; docs recommend `emailAndPassword` off with `oidc`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S-m12 | `cookieCache` not mentioned                                | Accepted (verified, `cba:184-189`) | Added to 2.4, 4.4 and limitations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S-m13 | Off-origin `callbackURL` test passes nothing in tests      | Accepted                           | The test itself is deleted (A15); the rule (set `disableOriginCheck: false` and `disableCSRFCheck: false`, F35) applies to the remaining origin test in S5a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-m14 | Redirect URIs must be exact                                | Accepted                           | 8.1 §2 and the security-model operator list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S-m15 | Guards without mutant rows                                 | Accepted                           | Rows added: `oidc-refresh-delegated`, `oidc-logout-typ`, `oidc-jwt-azp-required`, `oidc-end-grant-sessions`, `oidc-refreshed-id-token-dropped`, `oidc-access-token-requires-user`, `oidc-account-provider-filter` (new test "never returns another provider's token"), `oidc-discovery-s256`, `oidc-idp-url-credentials`. The `requireUser` test is kept for this row (see A15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S-m16 | Missing negative tests                                     | Accepted except one                | Added: `link-social` with `idToken`; another provider's state (F5 → `nonce_binding_missing`, verified at `callback.mjs:102-104`); `iat` 60 s in the future; unknown `kid` in cooldown; `siteOrigins` redirect and post-logout URIs; `token_endpoint` http on a public host with a loopback issuer; claims kept out of extra user fields (F34). Rejected: "a back-channel POST through the Nuxt proxy with a cross-site `Origin` gets 403". The route's gate is the signed logout token, not the request origin; an IdP sends no `Origin`; and the recommended URL is the Convex site URL, not the proxy.                                                                                                                                                                                                                                                     |
| S-m17 | RFC 9207 matcher requires GET                              | Moot                               | The hook is deleted (A5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A1    | No local development story                                 | Accepted                           | 8.1 §10 with the local and cloud paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A2    | Keycloak setup only as a click list                        | Accepted                           | 8.1 §2 publishes one client JSON as the single source; S6a's fixture uses it; `KC_HOSTNAME`, direct access grants off, consent off, and the 2-15 min lifespan added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A3    | No answer for "who may use this app"                       | Accepted with a correction         | 8.1 §7 documents the Keycloak role gate. Correction: Keycloak runs authentication flows at sign-in, not at refresh, so removing a role does not cause `invalid_grant`. The docs say it takes effect at the next IdP sign-in, and to sign the user out in Keycloak to end sessions now.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A4    | No way to see why an issuer mismatches                     | Accepted in part                   | `logOidcFailure` logs `expected` and `received` outside the sanitizer (3.3); test "never logs the client secret". Config error messages still name only the rule: the operator already has the configured value, and a narrower rule is simpler to keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A5    | RFC 9207 hook closes no attack                             | Accepted                           | 3.5 replaced by the reason; sentinel, error code, metadata field, mutant row and two e2e tests deleted; D52 records it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A6    | `oidc.scopes` not needed                                   | Accepted                           | Deleted with its validation, `offline_access` rule, mutant row and tests; a `scopes` key now gets "does not support". Default client scope + audience mapper documented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A7    | No migration path for password users                       | Accepted in part                   | 8.1 §9: `account_not_linked` snippet and a cutover checklist. Changed: instead of "find unlinked users" (no public query exists for it), the checklist keeps `emailOTP` on until everyone has linked, so no unlinked user is locked out. Bulk pre-linking is listed as not offered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A8    | S5 too large, S6 mixes jobs                                | Accepted                           | S5a / S5b and S6a / S6b (6.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A9    | Refresh margins collide with short tokens                  | Accepted                           | One margin constant (`OIDC_REFRESH_MARGIN_MS`) for both paths, a documented and reasoned 2-minute minimum lifetime, Keycloak fixture at 300 s with tests that expire the stored token instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A10   | Invariant re-checks our own literals                       | Accepted                           | Deep freeze, invariant = "exactly one owned `oidc`" (3.9), `oidc-id-token-sign-in-closed` moved to equivalents with the F7 reason; test "is frozen".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A11   | Second twoFactor rule                                      | Accepted                           | The existing doors check is extended (2.3); mutant row points at it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A12   | Inconsistent error codes                                   | Accepted                           | One caller-visible code per concept (2.1 table): `OIDC_UNAVAILABLE` at sign-in and in the helper; every thrown code and its class listed in the JSDoc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A13   | Test-only seams                                            | Accepted                           | `now`, `sleep` and `resetOidcCachesForTest` deleted; fake timers and a unique issuer per fake IdP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A14   | Hashing `jti`                                              | Accepted                           | Key `oidc-logout-jti:${jti}`; `sha256Hex` and its test deleted. SHA-256 is still used once, inside `accountKey` (S-M1), where `crypto.subtle` is called directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A15   | Tests that guard nothing                                   | Accepted except one                | Deleted: "has no idToken config…", "refuses to refresh (single refresh owner)", "ignores oct keys", "sign-out refuses an off-origin callbackURL", the unit "caches discovery". Kept: "getOidcAccessToken without a session throws UNAUTHENTICATED", because it kills the `oidc-access-token-requires-user` mutant on our own call site (S-m15); the existing `requireUser` tests do not cover that call.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A16   | Constants belong to their modules                          | Accepted                           | 2.2: module-local, three exports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A17   | `disableRedirect` question can be closed                   | Accepted (verified, F36)           | Stated as a fact in 2.5; S6b checks only the client type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Maintainer decisions (2026-10-21)

- Q1: no IdP roles or groups in Convex in this change. Identity only; app roles stay in the app (for example `organization`); the docs show the Keycloak role gate. Revisit on a real request.
- Q2: wait for a real request.
- Q3: keep `email_verified` strict; document the Keycloak-side fix. No `trustEmail`.
- Q4: liveness check on, no opt-out.
- Q5: keep the IdP-managed user rule, no option.
- Q6: no migration helper now; docs say "pin the issuer".
- Q7: accept, with the 10 s deadline and documentation.
- Added slice S6c (after S6a): run sign-in, sign-out and back-channel logout against the real local Convex backend and through the Nuxt auth proxy with the Keycloak fixture, in the existing integration harness. This closes risk R1 and the spike's "not verified through the Nuxt proxy" gap. If the harness cannot host it without a large new fixture, S6c reports why and what it would need, and changes nothing.

## Round 2: six-view review (2026-10-22)

Six independent reviews of the built PR (protocol attacker, Better Auth doors,
MCP, enterprise IdPs, sessions and operations, developer and maintainer).
Scores 8, 8, 6, 6, 7, 7. Every finding and what happened to it:

| Finding | Outcome |
|---|---|
| The IdP check ran only at the Convex token mint; MCP clients kept access after a refused refresh (reproduced) | Fixed: one check on the Better Auth context, read by the mint and by every OAuth access-token issue (D54) |
| Fail-open without a limit (rejected client secret, outage) | Fixed: one hour after the stored access token expired, new tokens get 503 until the IdP answers |
| The IdP's `expires_in` decided the check interval | Fixed: stored expiry capped at 15 minutes when a refresh token exists |
| No refresh token off Keycloak (no `offline_access`); no API audience scope | Fixed: `oidc.scopes` |
| Entra ID refused (no `email_verified`) | Fixed: `xms_edov: true` counts; multi-tenant Entra stays unsupported (issuer per tenant) |
| No way to read IdP claims for roles; no way to refuse by claim | Fixed: `oidc.onSignIn({ ctx, userId, claims })`, a throw refuses the sign-in |
| A session from before the link kept minting (reproduced) | Fixed: linking ends the user's other sessions |
| `/change-password` wrote, then refused; reset mail went to IdP users | Fixed: refused before any write; no reset mail or code |
| The account-delete guard allowed calls without a route | Fixed: refused |
| Email-code cleanup deletes the credential row before the guard throws | Accepted: the credential is dead for an IdP-managed user, and the `oidc` row stays |
| A back-channel logout lost when ending the sessions failed (reproduced) | Fixed: a three-slot replay bucket, filled only after success |
| Forged unknown `kid` caused 503 and a false keys alert | Fixed: 400 with `AUTH_OIDC_KEY_UNKNOWN` inside the refetch cooldown |
| No user id in logs; no success line; mint refusal looked like any 401 | Fixed: `userId` on grant-end lines, `AUTH_OIDC_LOGOUT_ENDED`, mint codes `OIDC_SIGN_IN_REQUIRED` (401) and `OIDC_UNAVAILABLE` (503) |
| `OIDC_SIGN_IN_REQUIRED` with two meanings, undocumented codes, migration advice in conflict with the limitations page | Fixed in the docs: one action (start the IdP sign-in), all codes listed, migration with `disableSignUp` |
| No test catches a new Better Auth door after an upgrade | Fixed: `test/unit/better-auth-door-inventory.test.ts` (endpoints, call sites, versions) |
| Two overlapping Keycloak suites; a second bounded reader | Fixed: one integration suite; the shared reader |
| Token and key endpoints may point at any host | Not done: the issuer is the trust root, and Google's endpoints are on other hosts |
| Require `typ: logout+jwt` | Not done: older IdPs omit it |
| `private_key_jwt`, PAR, per-IdP-session logout, SCIM, SAML, several IdPs | Not done; listed as limits |
| Replace the key cache with jose's remote key set | Not done: it lacks the failure backoff and size limits that have mutant rows |
| `endGrant` keeps MCP consents | Kept: tokens and sessions end; consent is the user's choice for that client |
