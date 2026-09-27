# Security policy

## Supported versions

Security fixes go into the latest release line of each package: the newest
published version of `@lupinum/better-convex-nuxt` and
`@lupinum/better-convex-vue` (they share one version) and of
`@lupinum/better-convex-mcp`. Older versions do not receive fixes; upgrade to
the latest release.

Each `package.json` declares the dependency and peer version ranges that a
release supports. An application with authentication installs
`better-auth`, `@better-auth/core`, and `@better-auth/oauth-provider` at
exactly the versions that `@lupinum/better-convex-nuxt` lists.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it through a
private [GitHub Security Advisory](https://github.com/lupinum-dev/better-convex/security/advisories/new)
for this repository.

Include the affected package versions, the setup you used, the steps to
reproduce, the impact, and any fix you propose. We aim to acknowledge reports
within a week, and we agree on disclosure with you after a fix is available.

If the defect is in Better Auth or the Better Auth OAuth Provider, we report it
to those projects privately and coordinate the fix with them.

## Security model

The [security model page](https://better-convex.lupinum.com/docs/operations/security-model)
explains the trust boundaries in detail. In short:

- **Convex decides access.** Every Convex function checks the user,
  ownership, membership, and roles. Route middleware, hidden buttons, token
  scopes, and OAuth consent never replace that check. For a write, the check
  and the change run in the same transaction.
- **Better Auth stores identity.** Users, accounts, sessions, OAuth grants, and
  signing keys live only in the Better Auth Convex component. An application
  may keep a copy of user display data that it can rebuild, but no second
  identity or credential store.
- **One browser path.** The browser and Nuxt server rendering reach Better
  Auth only through `/api/auth` on the application's own origin. Nuxt forwards
  these requests to Convex HTTP actions. The proxy forwards only GET and POST.
  It answers the CORS preflight for the public OAuth token route itself. It
  limits body sizes, forwards only Better Auth cookies, and never lets request
  headers choose an origin, issuer, or redirect target.
- **Separate token types.** A Convex session token is RS256, has
  `token_use = "convex-session"`, and lives at most 15 minutes. An OAuth
  access token for MCP has `token_use = "oauth-access"`, one exact resource,
  and lives at most 10 minutes. Each boundary rejects the other token type.
- **Live session checks.** `auth.getUser(ctx)` and `auth.requireUser(ctx)`
  check that the session still exists and belongs to the user's current
  security generation. A password reset ends all earlier sessions.
  `ctx.auth.getUserIdentity()` alone does not check revocation.
- **Rate limits.** Better Auth rate limits are stored in the Convex component.
  When a deployment names a trusted client-IP header, Nuxt signs the IP
  address with `BCN_AUTH_PROXY_IP_SECRET`, so a caller cannot choose a
  rate-limit bucket. Any process-local defense in depth is only an extra
  layer. Deployments still need a
  trusted-ingress per-account and per-IP limiter for distributed abuse.
- **Passwords.** Better Auth hashes and checks passwords. The maintained
  examples require 15 characters and turn off sign-in after sign-up.
  Deployments still own a breached/common-password blocklist, account
  recovery, and abuse controls.

### MCP and delegated OAuth

An MCP request follows one path:

```text
MCP host
  -> Convex /mcp HTTP action (@lupinum/better-convex-mcp)
  -> token verifier (auth.createMcpAccessVerifier or your own)
  -> tool registered in configureServer, with the verified principal
  -> internal Convex function that calls auth.requireMcpPrincipal
```

The verified `BetterConvexMcpPrincipal` holds identifiers (user, client,
session, grant, issuer, resource, scopes, expiry), not secrets. It is not proof
of access. Pass it only to internal functions, validated with
`mcpPrincipalValidator`. Each such function calls `auth.requireMcpPrincipal`
before any read or write. That call checks the session, client, resource, and
consent again, in the function's transaction, and checks the required scope. A
forged or stale principal therefore never exceeds the live consent, client, and
resource scopes of that user. `mcpPrincipalValidator` must never be used on a
public query, mutation, or action: a public function would let any caller name
another user's identifiers.

The OAuth provider accepts only operator-created clients, the authorization
code flow with PKCE S256, explicit consent, exact redirect URIs, and one
resource per token. Dynamic client registration, client credentials, implicit
flow, and password grant are off. Refresh tokens exist only when renewal is on,
and they end with the Better Auth session that granted consent. The
[delegated OAuth and MCP guide](https://better-convex.lupinum.com/docs/build/authentication/delegated-oauth-and-mcp)
describes the full profile.

### Browser risk

The browser holds the Convex session token, because Convex subscriptions need
it. An XSS flaw or a compromised same-origin script can act as the user and
copy the token until it expires. The `HttpOnly` session cookie does not
prevent this. Render data with Vue text interpolation, sanitize HTML that you
render on purpose, limit third-party scripts, and set a Content Security
Policy. Never put the token in local storage, URLs, logs, analytics, or error
messages.

### What remains your responsibility

An already-issued Convex session token stays valid for at most 15 minutes after
its session is revoked, at functions that do not check the live session. An
OAuth access token stays valid for at most 10 minutes, but every MCP operation
checks the live grant.

You own TLS, host validation, subdomain isolation, the trusted proxy
configuration, secret storage and rotation, account recovery, the Content
Security Policy, authorization rules, backups, log access, and incident
response. Use separate data, origins, and secrets for preview deployments.
Never log session cookies, tokens, OAuth client secrets, authorization codes,
private keys, or signed IP headers.

## Security ownership and incident response

This repository is responsible for the security of the code it ships: the
Convex adapter and component, the Nuxt auth proxy, the Convex session token
exchange, the signing-key handling, the OAuth profile, and the MCP package.
Better Auth and its OAuth Provider are responsible for their own protocol and
cryptography.

If a secret or credential leaks, contain it first:

| What leaked                        | First steps                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRETS`              | Close `/api/auth` and `/mcp` at your proxy. Revoke sessions. Add a new first secret version and restart Convex. Rotate the signing key. Remove the old version only after all stored encrypted data works without it.                  |
| `BCN_AUTH_PROXY_IP_SECRET`         | Close public auth traffic or stop forwarding the client IP header. Set one new secret in Nuxt and Convex and restart both. Do not accept both secrets at once.                                                                         |
| A session or browser token         | Revoke the session with the Better Auth session API. Disable the account or membership in Convex if needed. A stolen Convex session token has no deny list, so it can work for up to 15 minutes at functions that skip the live check. |
| A confidential OAuth client secret | Disable the client with `auth.oauthOperator.setClientDisabled`. Delete its consents. Rotate its secret through the OAuth Provider admin API before you enable it again.                                                                |
| An OAuth consent or access token   | Revoke the grant with `auth.oauthConnections.revoke`. The next MCP call fails the live check. If you cannot trust the live check, close `/mcp` for at least 10 minutes.                                                                |
| A signing key                      | Close token issuance. Run the internal `auth:rotateSigningKey` action. Rotation keeps old public keys for a grace period, so keep affected routes closed until the old key is gone from the public key set.                            |
| A published package version        | Publish a fixed version through the protected release workflow. Deprecate the affected range on npm. Never reuse or unpublish a version.                                                                                               |

Record each step in a private incident record. Never put credentials, tokens,
cookies, authorization codes, private keys, or signed IP headers in that
record.
