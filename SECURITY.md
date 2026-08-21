# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release. Older minors are unsupported after a newer minor is published.

The current package family consists of the `@lupinum/better-convex-nuxt@1.0.0-beta.1`,
`@lupinum/better-convex-vue@1.0.0-beta.1`, and `@lupinum/better-convex-mcp@1.0.0-beta.1`
prerelease candidates. The Nuxt candidate uses Node
`^22.12.0 || ^24.11.0 || >=26.0.0`, Nuxt `4.5.2`, Convex `1.42.2`, Better Auth
`1.7.0-rc.2`, `@better-auth/oauth-provider` `1.7.0-rc.2`, and Convex Helpers
`0.1.114`.
Each package manifest is canonical for its own dependencies and peers; each
reviewed release descriptor binds its package manifest into that package's
artifact proof. The hosted `release-gate` certifies source once before the
protected workflow mints the three package candidates. Post-mint verification
is artifact-only. Convex and Nuxt are exact required peers of the Nuxt package.
Better Auth and the OAuth Provider are exact optional peers installed only by
auth-enabled applications. Better Auth owns its Kysely dependency; Better Convex
does not redeclare it. An auth-enabled application resolves one physical
instance of each stateful runtime in the tuple.

This is not yet a stable authentication tuple. Stable publication is blocked until a compatible stable Better Auth 1.7 release exists and the human release gates below pass.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use a private GitHub Security Advisory for this repository. Include affected versions, prerequisites, reproduction steps, impact, and any proposed mitigation. Maintainers will acknowledge a complete report within three business days and coordinate disclosure after a fix is available.

## Security architecture

Better Auth is the sole source of auth-user, account, session, verification, OAuth, and signing-key state. That state lives in one Better Auth component database. An application may keep a clearly documented, rebuildable user display projection, but it must not create a second identity or credential store.

Convex remains the source of truth for application authorization. UI route guards, token scopes, consent, and cached capabilities never replace a live backend ownership, membership, role, delegation, or resource check.

The supported browser path is fixed:

```text
browser or Nuxt SSR
  -> same-origin /api/auth/*
  -> bounded Nuxt proxy
  -> Convex HTTP Actions
  -> Better Auth component
```

The supported delegated MCP path is fixed on the application-owned Convex
resource:

```text
OAuth/MCP client
  -> configured Convex site origin /mcp
  -> application HTTP action using better-convex-mcp
  -> application-supplied exact access-token verifier
  -> explicit official-SDK tool registration
  -> named internal Convex function
```

`starters/mcp-oauth-agent/convex/http.ts` and `convex/mcp.ts` are the maintained
production trace for that composition. Better Convex Nuxt owns no `/mcp` route
or bearer-token proxy. There is no generic function bridge, caller-selected
upstream, caller-supplied principal, raw-token function argument, or extra
shared MCP secret.

## Enforced invariants

- The public origins are configured statically. `convex.auth.origin`/`SITE_URL` and `CONVEX_SITE_URL` are validated as bare origins. Incoming `Host`, `Forwarded`, `X-Forwarded-*`, and request URLs never select an issuer, callback, JWKS URL, redirect target, or trusted origin.
- Browser auth uses the fixed same-origin `/api/auth` base path. The proxy accepts only GET and POST, bounds request and response bodies, filters cookies to Better Auth's namespace, strips hop-by-hop and forwarding controls, and does not follow upstream redirects with credentials.
- When a deployment configures an ingress-owned client-IP header, Nuxt strips caller copies, canonicalizes one address, and signs it with `BCN_AUTH_PROXY_IP_SECRET`. Convex accepts only that signature or its own direct request metadata. Callers cannot select a Better Auth rate-limit bucket.
- Better Auth rate limiting is enabled with database storage. The adapter implements the counter update atomically; there is no process-local security counter. Any process-local defense in depth is non-authoritative; deployments still own a trusted-ingress per-account and per-IP limiter for distributed abuse.
- Every auth row has a required immutable Better Auth logical `id`. Convex `_id` and `_creationTime` remain internal storage details and are never protocol identity.
- Nullable auth fields have one stored empty representation: explicit `null`. Omitted update fields remain unchanged; explicit `null` clears them.
- Logical-ID and unique-field checks execute in the same Convex mutation as the write. `consumeOne` and `incrementOne` are single mutations. Bulk updates cannot change `id` or generated unique fields.
- The packaged component and application-owned local components import the same adapter implementation. A generated schema and metadata fingerprint pair must match before adapter functions initialize.
- Better Auth owns password hashing and verification. Applications must not add another password store or hashing path. The maintained examples use a 15-character minimum and `autoSignIn: false`; deployments still own a breached/common-password blocklist, recovery controls, and distributed abuse controls.
- `BETTER_AUTH_SECRETS` is mandatory and versioned with the newest key first. Better Auth owns the envelope and rotation format. Social-provider access and refresh tokens are encrypted by Better Auth; Better Convex Nuxt encrypts provider ID tokens at the same adapter boundary because the pinned RC misses those writes. Verification identifiers are stored hashed.
- A Convex session JWT is minted only by `/api/auth/convex/token`, after session middleware and a fresh component read confirm a current persisted session and matching user. The generic JWT `/token` route, automatic JWT response header, JWT cookie, and sign-in/callback mint hooks are disabled.
- A Convex session JWT is RS256, has `token_use = "convex-session"`, exact issuer `CONVEX_SITE_URL`, audience `convex`, a maximum 15-minute lifetime, and an allowlisted payload. Convex functions that use the component helpers recheck the persisted session.
- Public JWKS output contains public key material only. Private JWK members and stored rows must never appear in an operator response, error, trace, source map, or artifact.
- The initial signing key is provisioned through the internal `rotateSigningKey` operator action before public auth traffic. Later rotations are additive and retain earlier verification keys through the complete token, cache, and skew grace period.
- Convex session JWTs and delegated OAuth access tokens are different token classes and are rejected at the wrong boundary.

## Delegated OAuth beta profile

OAuth protocol behavior comes from the exact official Better Auth OAuth Provider peer. Better Convex Nuxt constrains it to one reviewed profile:

- confidential web clients and public agent clients provisioned by an authorized operator;
- authorization code only;
- `client_secret_basic` for confidential clients and `none` for public clients;
- exact pre-registered HTTPS redirects, or canonical HTTP loopback redirects whose
  IP-literal runtime port alone may vary under RFC 8252;
- PKCE S256;
- explicit consent;
- one exact registered resource per access token;
- allowlisted scopes;
- RS256 `at+jwt` access tokens with `token_use = "oauth-access"` and a maximum 10-minute lifetime;
- database-backed rate limiting;
- no refresh tokens or `offline_access`.

Dynamic client registration, client credentials, implicit flow, password grant, refresh tokens, DPoP, pushed authorization requests, client ID metadata documents, multi-resource tokens, introspection, UserInfo, end-session, and outbound OIDC identity-provider behavior are disabled for the first beta. Public clients must be preregistered with exact HTTPS redirects or canonical HTTP loopback shapes, use `token_endpoint_auth_method = none`, and complete S256 PKCE; only an IP-literal loopback runtime port may vary, and public clients never receive or share a client secret.

The authorization-server and protected-resource metadata documents are public
and return `Access-Control-Allow-Origin: *` without credentialed CORS. The only
cross-origin browser exception under `/api/auth` is the public-client form token
exchange: exact `POST /oauth2/token` plus its exact `OPTIONS` preflight, no query,
Cookie, Authorization, proxy authorization, or DPoP, and a bounded
`application/x-www-form-urlencoded` body. Upstream CORS headers and token
cookies are rejected. Authorize, revoke, session, consent, administration, and
all other auth routes retain the same-origin boundary. The provider's existing
guard still validates the stored public `none` client, PKCE, redirect URI,
resource, code, and grant before any token is issued.

Provider account cookies and the Better Auth `/get-access-token` and `/refresh-token` routes are disabled. External-provider identity remains available to Better Auth inside the auth process, but exporting provider API tokens to application or browser code is unsupported.

The resource verifier requires signature, RS256, `typ = at+jwt`, exact issuer, exact scalar audience/resource, client, authorized party, subject, session, scopes, token class, and time bounds. It re-reads the raw compact payload only after official signature verification because the pinned upstream verifier normalizes returned `client_id` from `azp`; conflicting signed raw claims must still fail.

OAuth scopes are ceilings, not frozen application permissions. Every MCP operation performs live authorization in Convex. For a write, the live authorization check and state change must share the same transaction. Removing a membership, consent, client, session, or delegation takes effect at that live check; a self-contained token's remaining individual bearer window is otherwise bounded by its 10-minute lifetime.

Enterprise workforce OIDC SSO is a later phase. The authorization-server beta must not be represented as enterprise SSO support.

The operational contract is documented in the [delegated OAuth and MCP guide](./docs/content/docs/4.build/3.authentication/10.delegated-oauth-and-mcp.md).

## Schema-changing Better Auth plugins

The packaged schema contains the maintained core/JWT/OAuth profile. Plugins that add tables or fields—such as organizations, admin, API keys, or two-factor authentication—use one fresh application-owned local component. The checked-in schema and metadata are generated together from the same build-only options with `better-convex auth schema`.

Do not copy the adapter, mount both packaged and local components, or enable a runtime plugin absent from the generated schema. Two-factor must be ordered before `convexAuth()` and must prove that a first-factor-only session cannot obtain a Convex token.

## Secrets, credentials, and logs

- Generate every secret independently with a cryptographically secure generator. Do not reuse Better Auth, proxy, provider, OAuth-client, or deployment credentials.
- `BETTER_AUTH_SECRETS` exists only in Convex and its secret manager. `BCN_AUTH_PROXY_IP_SECRET` exists only in the Nuxt server, Convex, and their secret managers. Neither belongs in public runtime config.
- Treat the Better Auth component database, backups, exports, and operational access as credential-bearing.
- Never log or attach session cookies, Convex JWTs, OAuth client secrets, authorization codes, access tokens, social-provider tokens, private key material, signed IP headers, or raw auth error causes.
- High-verbosity auth logging is local diagnostics only. It does not authorize credential-bearing request or response dumps.
- Production source maps and test traces must not expose auth sentinels or private server code.

`pnpm test:auth-export-sentinels` creates a unique local deployment, drives real
OAuth and protected-storage writes, downloads the pinned backend's component
snapshot, and scans its bounded uncompressed contents. The snapshot and the
temporary application are mode-restricted and deleted in a finalizer; the gate
fails when export or required component-table coverage is unavailable.

## Browser XSS and active bearer boundary

The browser-held Convex JWT is an active bearer credential used for HTTP and WebSocket calls. Application JavaScript can use it while authenticated, and it may participate in authenticated SSR hydration. Never copy it into local storage, URLs, rendered markup, analytics, logs, or error messages.

An `HttpOnly` Better Auth session cookie does not make same-origin script execution harmless. XSS or a compromised same-origin dependency can act as the user and can exfiltrate the browser-readable JWT until expiry. Render backend-controlled values through Vue text interpolation, sanitize intentionally rich HTML for its exact context, minimize mutable third-party scripts, and enforce a deployment-specific Content Security Policy. CSP is defense in depth; backend authorization remains mandatory.

## Greenfield hard cut

The integrated auth component has no data migration, compatibility adapter, dual schema, legacy identity converter, or automatic mode selection. Do not connect it to a populated auth component from an earlier integration. Start with one fresh component mounted as `betterAuth`. Keeping old and new auth paths side by side is unsupported.

## Residual risk and operator responsibility

Already-issued stateless Convex session JWTs can remain usable for at most their configured lifetime, even after the cookie session is revoked. Delegated OAuth access tokens have the separately bounded lifetime above, while live application authorization is checked on every MCP operation.

An XSS flaw, compromised same-origin dependency, stolen bearer, compromised OAuth client, or operator credential can still cause harm within its authority and lifetime. Rate limiting is abuse resistance, not proof of legitimate intent. Availability also depends on Convex, the Nuxt deployment, configured providers, DNS, and ingress behavior.

Operators own TLS termination, host validation, sibling-subdomain isolation, trusted-ingress configuration, secret storage and rotation, provider and recovery ceremonies, CSP, authorization rules, backups, logging access, dependency response, and incident handling. Preview deployments need separate data, origins, and secrets.

A public prerelease uses the honest solo-maintainer model: private vulnerability
reporting is enabled, and the protected release run records the human tag actor,
checked-out commit author, tag, and source commit. The maintainer remains responsible
for package licensing and metadata without inventing a separate reviewer, deputy,
notification drill, or independent review. Independent review and operational backup
remain future stable-release criteria; they are not prerelease gates.

The project describes releases as hardened against a documented threat model. It does not claim complete or universal security.

## Upstream monitoring

`security/upstream-convex-better-auth.json` is the single provenance and upstream-review ledger. `pnpm check:auth-upstream` compares its reviewed observation with authoritative GitHub releases, repository advisories, issue `#395`, PR `#380`, the default-branch head, and changes limited to the ledger's enumerated source seams. Any drift, unresolved required patch, incomplete review, or review older than 31 days fails. The extended security workflow runs it nightly and on the monthly-review schedule; immutable prerelease verification runs it again before publication. `pnpm check:auth-advisories` remains the separate exact-resolved-tuple advisory decision gate and does not introduce a second hand-written CVE database.

## Dependency response targets

- Critical or known-exploited production dependency: assess immediately and publish or mitigate within 24 hours.
- High-severity production dependency: acknowledge within 24 hours, record a patch or mitigation decision within 72 hours, and publish or mitigate within seven days.
- Medium severity: disposition within 30 days.
- Low severity and development-only findings: disposition in the next regular maintenance cycle.

An exception must identify the affected version, exposure, concrete mitigation, owner, creation time, and expiry no later than 30 days.

## Security ownership and incident response

This repository owns the security response for the adapter, component schema and
functions, Nuxt auth proxy, Convex session-token exchange, shared JWKS graph,
OAuth profile enforcement, and maintained MCP integration that it ships. The
official Better Auth and OAuth Provider projects own their protocol and
cryptographic implementations. Report a suspected defect here first; the BCN
Security Owner coordinates a private upstream report when the defect crosses
that boundary.

The following are operator runbooks, not automated claims. Secret-manager,
Convex, ingress, cloud, client-owner, npm, and disclosure actions must be
performed by authorized humans and recorded in the private incident record. Do
not put credentials, compact tokens, cookies, authorization codes, private JWKs,
or signed IP headers in that record.

For every incident:

1. The operator appoints an incident commander, records the affected deployment
   and earliest possible exposure, and applies the response target above.
2. Contain the narrowest affected boundary. Close `/api/auth` or `/mcp` at the
   trusted ingress when the relevant administrative control is unavailable or
   its integrity is in doubt.
3. Preserve redacted logs, deployment identifiers, package versions, key IDs,
   client IDs, user/session IDs, and timestamps. Preserve component state; do
   not delete tables or attach raw credentials as evidence.
4. Recover with reviewed changes through the normal immutable release and
   deployment path. Reopen traffic only after the affected negative tests,
   expiry bounds, and live revocation checks pass in the real deployment.
5. Record notification, containment, rotation/revocation, verification, and
   disclosure decisions. Repository tests do not prove that an external
   operator action happened.

### Compromised `BETTER_AUTH_SECRETS`

Treat this as possible cookie/session forgery and exposure of encrypted provider
tokens and private signing-key material.

1. **Operator action:** close auth issuance and token-consuming routes, revoke
   affected Better Auth sessions through Better Auth's session/admin APIs, and
   disable affected delegated clients, resources, and application grants.
2. **Secret-manager action:** generate an independent higher-numbered version,
   place it first in `BETTER_AUTH_SECRETS`, and restart the Convex deployment.
   Keep the compromised version available only while traffic is closed and only
   for controlled decryption/re-encryption; adding a new first key is not itself
   containment.
3. Inventory every ciphertext class that can require the old version, including
   account access/refresh/ID tokens and encrypted private JWKs. Rewrite them
   through supported Better Auth operations. If the deployed application lacks
   a safe bounded rewrite, keep traffic closed and ship a reviewed internal
   maintenance forward fix; never export plaintext or write component tables
   directly.
4. Run the signing-key procedure below. Rotate or revoke affected upstream
   provider credentials through each provider's operator console. Reset other
   credentials only when the incident scope shows they were exposed; hashed
   OAuth client secrets are not made recoverable by this secret alone.
5. Remove the compromised version only after an inventory and decryption
   rehearsal prove that retained state works with the new versions alone. Force
   reauthentication and keep affected consumers closed until old cookies and
   bounded bearer tokens can no longer be accepted.

### Compromised proxy IP-signing secret

This secret authenticates rate-limit attribution, not a user identity, but its
loss can let an attacker choose signed client-IP buckets.

1. **Ingress action:** close public auth traffic or remove the trusted forwarded
   IP path while retaining a trustworthy direct-IP limiter. Confirm the ingress
   still overwrites caller copies of the configured IP header.
2. **Secret-manager/cloud action:** generate one new independent
   `BCN_AUTH_PROXY_IP_SECRET`, apply it to Nuxt and Convex under the traffic
   gate, and restart both. Do not add a dual-secret acceptance window.
3. Verify that unsigned, old-signed, malformed, and caller-supplied values cannot
   select a bucket; verify two legitimate source IPs remain distinct and the
   database-backed limit still resets as configured.
4. Review redacted rate-limit and ingress records for bucket evasion during the
   exposure window, then reopen auth traffic.

### Compromised sessions or browser bearer tokens

1. Revoke one session with the supported Better Auth session API, all sessions
   for the affected account with the supported account/admin flow, or the
   scoped set with a reviewed operator-only action. Do not patch component rows
   from application code.
2. Disable the affected account, membership, delegation, or high-risk operation
   in canonical Convex state when immediate application containment is needed.
3. Force reauthentication and investigate account recovery, MFA, XSS,
   same-origin dependencies, and logging exposure before restoring authority.
4. A stolen Convex session JWT has no individual denylist and can remain usable
   at functions that trust only stateless identity until its maximum 15-minute
   expiry. Keep those operations or the affected ingress closed for that bound,
   or ship a reviewed live-revalidation forward fix. Rotating a signing key does
   not revoke an already accepted token while its old key remains published.

### Compromised confidential OAuth client secret

1. **OAuth operator action:** disable the client and unlink its resource through
   a provider-owned privileged admin flow. If that flow is unavailable, close
   the affected authorization and `/mcp` routes. Never enable the disabled raw
   client-management routes or write OAuth rows through the adapter.
2. Delete affected user consents through the provider-owned consent API and
   revoke app-owned memberships/delegations through their canonical Convex
   mutations. Revoke affected Better Auth sessions when user compromise is also
   possible.
3. Rotate the client secret through a provider-owned privileged dispatch,
   deliver it once through an approved secret channel, and require the client
   owner to retire the old value. Public clients have no secret and use the
   client/consent containment procedure instead.
4. Verify the old `client_secret_basic` credential fails, the new credential
   succeeds only for the exact client/resource/redirect profile, and no new code
   can be redeemed with the old credential before re-enabling the client.

### OAuth consent and access-token containment

1. For one user/client grant, delete the consent with the provider-owned consent
   API and revoke the app-owned delegation. For a client-wide event, disable the
   client; for a resource-wide event, disable or unlink the resource and close
   `/mcp` if needed.
2. The beta issues self-contained JWT access tokens. The revocation endpoint
   cannot individually revoke that token class, and no second denylist exists.
   Immediate denial comes from the live session, client, resource link, consent,
   membership, and delegation checks on every MCP operation.
3. If any required live check cannot be trusted, keep the affected resource
   route closed until the maximum 10-minute token lifetime, public-key cache,
   and clock allowance have elapsed. Verify the captured token is then denied
   without logging it.
4. Re-enable only after a fresh authorization-code/PKCE/consent flow succeeds
   and the old consent, client, resource, or delegation state still fails live.

### Compromised signing key

1. Close Convex-session and OAuth-token issuance and every affected
   token-consuming route. Record only the compromised `kid` and time window.
2. **Convex operator action:** run the internal `auth:rotateSigningKey` action,
   verify its `newKid` in public JWKS, and verify newly issued session and OAuth
   tokens use it. Never expose key rows or delete all JWKS state.
3. Ordinary rotation deliberately retains prior verification keys for the
   token/cache/skew grace period, so it is not immediate containment of a stolen
   private key. Keep consumers closed through `previousVerifyUntil`, or deploy a
   reviewed forward fix that retires only the compromised `kid` and accepts the
   resulting invalidation of legitimate tokens signed by it.
4. Revoke affected sessions, clients, consents, and delegations; rotate
   `BETTER_AUTH_SECRETS` too when it may have exposed the encrypted private JWK.
5. Reopen only when the compromised `kid` is absent from public JWKS and caches,
   forged/old tokens fail, new tokens pass, and the remaining key inventory is
   decryptable. Do not roll back to an artifact that can issue with the old key.

### Affected package versions

1. Define the exact affected and fixed ranges from the canonical dependency
   tuple and release evidence. Do not silently widen the claim to untested
   versions.
2. Fix forward on a new version through the protected trusted-publishing
   workflow. Never reuse a version, repack tested bytes, unpublish, or restore a
   vulnerable auth/schema path beside the fix.
3. **npm owner action:** after the fixed version or an owned mitigation exists,
   deprecate the affected range with an upgrade message and verify the registry
   metadata. This external action requires package-owner approval and evidence;
   checking in this runbook does not perform it.
4. Publish coordinated release notes that identify affected/fixed versions,
   exposure and prerequisites, required operator action, and any schema,
   protocol, session, client-secret, consent, or signing-key reset. Keep exploit
   detail private until coordinated disclosure permits publication.
