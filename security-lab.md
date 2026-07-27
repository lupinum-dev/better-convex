# Better Convex Nuxt Security Lab

> The “Fort Knox” playbook for building high, evidence-based confidence in
> Better Convex Nuxt. Security is never absolute. This lab is designed to make
> important failures difficult to introduce, easy to detect, safe to reproduce,
> and fast to correct.

## 1. Purpose

Better Convex Nuxt sits on authentication, session, OAuth, MCP, SSR, proxy, and
database trust boundaries. A large unit-test count is not enough. The project
needs independent evidence that the exact package a consumer installs behaves
correctly through browsers, Vercel, Nuxt/Nitro, a real Convex backend, Better
Auth, OAuth clients, and MCP clients.

This document defines:

- the security properties we defend;
- a disposable production-like attack lab;
- the manual and automated attacks to run;
- safe observability and evidence handling;
- what CI, an LLM agent, and a human reviewer each own;
- release gates and stop conditions;
- how a discovered issue becomes a permanent regression test.

This is a living operational document. A checked box is evidence only when it
links to an immutable commit, package artifact, deployment, command, and bounded
result. “The code looks correct” is not release evidence.

### Status vocabulary

- **Existing:** implemented in this repository today.
- **Proposed:** desired automation that must not be cited as evidence until it
  exists and passes from a clean checkout.
- **External:** requires a real disposable deployment, protected credentials, or
  a person independent of the primary implementation.
- **Human-only:** an LLM may prepare evidence, but a named person must make the
  decision.

## 2. Security posture and non-negotiable principles

1. **One source of identity truth.** Better Auth owns users, accounts, sessions,
   verification state, OAuth state, and signing keys.
2. **Authorization stays live in Convex.** Token scopes are ceilings. Every
   organization, membership, delegation, resource, and tool decision is checked
   against current backend state.
3. **One supported browser path.** Browser and SSR traffic use the fixed
   same-origin `/api/auth/*` Nuxt proxy.
4. **Token classes never substitute for each other.** Convex session JWTs,
   OAuth access tokens, ID tokens, authorization codes, and provider tokens have
   different boundaries.
5. **Backend invariants are atomic.** Logical-ID uniqueness, one-time
   consumption, counters, authorization, and protected writes do not depend on
   frontend sequencing.
6. **Fail closed.** Ambiguous configuration, malformed input, missing
   privileges, unavailable evidence, and dependency drift block the operation
   or release.
7. **Exact artifact evidence.** Test the immutable tarball a consumer installs,
   not a workspace that can resolve undeclared files or dependencies.
8. **No credential-bearing diagnostics.** Logs, errors, traces, HARs, exports,
   screenshots, and CI artifacts are hostile surfaces.
9. **Greenfield hard cut.** No migration bridge, compatibility runtime, second
   adapter, dual schema, or automatic legacy mode.
10. **Independent review matters.** The implementer, tests, and LLM can share the
    same mistaken assumption. Stable release requires a human reviewer who was
    not the primary implementer.

## 3. Threat model

### 3.1 Trust boundaries

```text
Browser / SSR / OAuth or MCP client
              |
              v
        Vercel / CDN / TLS
              |
              v
       Nuxt / Nitro application
        |                 |
        | /api/auth/*     | /mcp
        v                 v
  bounded auth proxy   bounded MCP relay
        |                 |
        +--------+--------+
                 v
        Convex HTTP Actions
                 |
                 v
      Better Auth component DB

Application authorization remains in current Convex application state.
```

Each arrow is a place where headers, origins, cookies, bodies, identities,
timeouts, redirects, or credentials can be confused.

### 3.2 Assets

- Better Auth session cookies and session rows;
- Convex session JWTs;
- OAuth authorization codes and PKCE verifiers;
- OAuth access tokens and client secrets;
- provider access, refresh, and ID tokens;
- private signing keys and Better Auth encryption secrets;
- proxy client-IP signing secret;
- organization membership, delegation, resource ownership, and tool authority;
- deployment keys, npm publication authority, and release provenance;
- logs, traces, browser storage, database exports, and backups.

### 3.3 Attackers to simulate

- anonymous internet caller;
- malicious authenticated user;
- user from another tenant;
- removed or suspended member with an unexpired token;
- malicious OAuth public client;
- compromised OAuth confidential client;
- caller replaying or substituting a token/code;
- hostile sibling origin or subdomain;
- caller spoofing proxy and client-IP headers;
- user controlling IDs, paths, query fields, form fields, and request sizes;
- compromised same-origin script acting through the browser;
- dependency or release artifact that differs from reviewed source;
- operator making an incorrect environment or secret-rotation change.

### 3.4 Out-of-scope claims

The lab does not prove:

- absence of every vulnerability;
- security of arbitrary authorization code written by a consuming application;
- security of an operator’s Vercel, Convex, DNS, GitHub, or npm account;
- enterprise OIDC SSO, which is later scope;
- formal protocol certification;
- protection after an attacker gains full deployment or secret-manager control.

## 4. Disposable attack-lab topology

Never run destructive security evidence against production, shared staging,
valuable data, or a deployment that must be reused.

```text
commit-addressed pkg.pr.new package
              |
              v
clean external mcp-oauth-agent-based consumer
              |
      +-------+-------+
      |               |
      v               v
Vercel Preview    fresh Convex deployment
fixed HTTPS URL   synthetic data only
```

### 4.1 Required isolation

- one fresh Convex deployment;
- one fixed Vercel preview origin;
- secrets generated only for this lab;
- no production providers unless they have dedicated test applications;
- synthetic users and organizations;
- no shared OAuth clients;
- no valuable data;
- explicit owner-controlled destruction after evidence collection;
- short evidence retention;
- no manual writer while concurrency or cleanup evidence runs.

### 4.2 Synthetic actors and state

Create at least:

| Actor               | State                              | Purpose                    |
| ------------------- | ---------------------------------- | -------------------------- |
| Alice               | administrator of Organization A    | privileged human path      |
| Bob                 | regular member of Organization B   | cross-tenant attacker      |
| Carol               | member removed from Organization A | stale-token/live-auth test |
| OAuth Owner         | `oauthAdmin` capability            | client provisioning        |
| Public client       | `none` authentication + S256 PKCE  | agent/Inspector path       |
| Confidential client | `client_secret_basic`              | server client path         |

Create resources owned by both organizations and at least one read-only and one
write-capable delegation.

### 4.3 Environment contract

The lab must prove that these values agree where applicable:

- `SITE_URL`;
- `CONVEX_URL`;
- `CONVEX_SITE_URL`;
- `NUXT_PUBLIC_CONVEX_URL`;
- `NUXT_PUBLIC_CONVEX_SITE_URL`;
- `BCN_AUTH_PROXY_IP_SECRET` on Nuxt and Convex;
- `BETTER_AUTH_SECRETS` only in Convex/its secret manager.

Use a fixed Vercel preview alias. A changing preview hostname changes the OAuth
issuer, callback, cookie, CORS, and registered-client contract.

## 5. Evidence hygiene

### 5.1 Safe evidence fields

- commit SHA;
- package version, SHA-256, and SRI;
- deployment identifiers and canonical origins;
- dependency tuple;
- test/corpus name and seed;
- request ID;
- method and pathname without sensitive query data;
- phase, status, duration, and bounded byte counts;
- token class name, never token value;
- booleans such as `issuerMatched`, `resourceMatched`, or `sessionPersisted`;
- aggregate row counts and pass/fail results.

### 5.2 Forbidden evidence

Never log, commit, upload, paste into an issue, or send to an LLM:

- passwords or recovery material;
- session cookie values;
- Authorization headers;
- Convex JWTs, OAuth access tokens, or ID tokens;
- authorization codes or PKCE verifiers;
- OAuth client secrets;
- provider credentials;
- signed proxy-IP headers;
- private keys or Better Auth secrets;
- raw auth request/response bodies;
- full OAuth URLs with query strings;
- database rows from credential-bearing tables;
- unsanitized HARs, Playwright traces, screenshots, or exports.

Playwright storage-state files are credentials. Keep them outside Git, restrict
their permissions, use only synthetic users, and delete them after the run.
Traces and HARs may contain bodies and headers; treat them as secrets until a
human has sanitized them.

## 6. Existing automated baseline

These commands exist today and are the foundation of the lab:

| Purpose                                         | Command                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| formatting, lint, types, boundaries, core tests | `pnpm check`                                      |
| ASVS, SBOM, contracts                           | `pnpm verify`                                     |
| complete auth matrix                            | `pnpm verify:auth`                                |
| immutable candidate and full release graph      | `pnpm release:prepare`                            |
| OAuth profile and negative matrix               | `pnpm test:oauth`                                 |
| deterministic hostile-input corpus              | `pnpm test:auth-fuzz`                             |
| real-backend races and quotas                   | `pnpm test:auth-concurrency`                      |
| MFA/final-session behavior                      | `pnpm test:auth-mfa`                              |
| artifact/runtime credential sentinels           | `pnpm test:auth-sentinels`                        |
| database-export sentinels                       | `pnpm test:auth-export-sentinels`                 |
| full browser/SSR E2E                            | `pnpm test:e2e:full`                              |
| running proxy DAST                              | `pnpm test:dast:proxy`                            |
| real OAuth/MCP clients                          | `pnpm test:mcp-auth`                              |
| selected official MCP scenarios                 | `pnpm test:mcp-conformance`                       |
| schema generation/deployment freshness          | `pnpm check:auth-schema`                          |
| advisories and audits                           | `pnpm check:auth-advisories`                      |
| upstream drift                                  | `pnpm check:auth-upstream`                        |
| clean candidate consumers                       | `pnpm check:candidate-apps --tarball <exact.tgz>` |

The package preview workflow publishes only the exact evidence-bound tarball
for a same-repository pull request. A pkg.pr.new preview is validation transport,
not an npm release.

## 7. Proposed automation facade

The following commands are **proposed**, not implemented. When implemented,
they should compose existing direct scripts rather than introduce another
security implementation or source of truth.

```text
pnpm security:lab:prepare    # validate disposable topology; make no app data
pnpm security:lab:browser    # Playwright multi-role and storage/network evidence
pnpm security:lab:http       # raw HTTP and proxy edge cases
pnpm security:lab:oauth      # deployed OAuth negative/replay/binding matrix
pnpm security:lab:mcp        # external-disposable real clients and live authz
pnpm security:lab:zap        # constrained ZAP plan against the owned lab only
pnpm security:lab:soak       # bounded load, expiry, rotation, and cleanup
pnpm security:lab:all        # exact artifact plus every non-human lab gate
pnpm security:lab:destroy    # explicit owner-controlled teardown helper
```

Rules for this facade:

- accept an exact artifact manifest or commit-addressed pkg.pr.new URL;
- require `BCN_SECURITY_LAB_CONFIRM_DISPOSABLE=yes` before destructive work;
- prove all origins match before the first write;
- require a deployment marker created specifically for the lab;
- refuse known production and protected-staging identifiers;
- print a plan before mutation;
- never infer cleanup ownership;
- save only bounded non-secret JSON evidence;
- fail if a required scenario runs zero tests;
- fail if the expected real backend/client/browser is unavailable;
- use total timeouts and no unbounded retries;
- leave infrastructure destruction to the explicit owner-controlled command.

## 8. Playwright security project

### 8.1 Proposed structure

```text
test/security-lab/
├── auth-lifecycle.spec.ts
├── authorization-matrix.spec.ts
├── browser-storage.spec.ts
├── csrf-origins.spec.ts
├── oauth-browser.spec.ts
├── ssr-settlement.spec.ts
├── cache-headers.spec.ts
├── fixtures/
│   ├── actors.ts
│   ├── evidence.ts
│   └── topology.ts
└── global-teardown.ts
```

Run Chromium, Firefox, and WebKit for the external candidate. Use separate
`BrowserContext` instances for anonymous, Alice, Bob, Carol, and OAuth Owner.
Do not reuse an authenticated context across tests that mutate session state.

### 8.2 Safe network observer

Observe request shape without recording bodies, headers, cookie values, or
queries:

```ts
context.on('request', (request) => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/auth') && url.pathname !== '/mcp') return

  evidence.record({
    method: request.method(),
    path: url.pathname,
    resourceType: request.resourceType(),
  })
})

context.on('response', async (response) => {
  const url = new URL(response.url())
  if (!url.pathname.startsWith('/api/auth') && url.pathname !== '/mcp') return

  evidence.record({
    cacheControl: await response.headerValue('cache-control'),
    path: url.pathname,
    status: response.status(),
  })
})
```

Do not call `request.postData()` in diagnostics. Do not collect all headers: a
response may contain `Set-Cookie`.

### 8.3 Browser authentication scenarios

- [ ] Signup does not create an unintended final session.
- [ ] Login produces one expected persisted session.
- [ ] A hard reload remains authenticated without an anonymous-data flash.
- [ ] Direct navigation to a protected SSR route settles correctly.
- [ ] Logout invalidates browser and Convex access.
- [ ] Browser Back after logout does not reveal sensitive cached content.
- [ ] Deleting the backend session invalidates an open page.
- [ ] Expired sessions settle without loops or stale identity.
- [ ] Alice logout followed immediately by Bob login never publishes Alice data
      or a token for Alice.
- [ ] Login/logout/account switching propagates safely across two tabs.
- [ ] MFA first-factor-only state cannot obtain a Convex session JWT.
- [ ] Lockout, reset, and recovery responses do not enumerate accounts.

### 8.4 Browser storage and cookies

Assert cookie metadata without printing values:

- [ ] `HttpOnly` is set for the session cookie.
- [ ] `Secure` is set on HTTPS.
- [ ] `SameSite`, `Domain`, and `Path` match the reviewed policy.
- [ ] No auth credential is stored in local storage.
- [ ] No auth credential is stored in session storage.
- [ ] No auth credential is stored in IndexedDB or Cache Storage.
- [ ] No credential appears in rendered HTML, hydration payload, URL, title,
      analytics event, or console message.
- [ ] Auth, consent, and protected responses use the required no-store/cache
      policy.

### 8.5 Multi-role authorization matrix

For every protected query, mutation, action, and MCP tool, test:

| Caller               | Target                  | Expected                       |
| -------------------- | ----------------------- | ------------------------------ |
| anonymous            | public resource         | explicit public policy         |
| anonymous            | protected resource      | deny                           |
| Alice                | Organization A          | allowed only by current role   |
| Alice                | Organization B          | deny                           |
| Bob                  | Organization A          | deny                           |
| Carol before removal | delegated A resource    | scope and policy dependent     |
| Carol after removal  | same token and resource | deny immediately at live check |

Do not test only button visibility. Invoke the protected backend operation
directly with another tenant’s identifier. After every rejected write, query a
test-only bounded evidence function and prove the database did not change.

## 9. Manual browser and DevTools ceremony

Manual inspection catches surprising sequences that an assertion author may not
anticipate.

1. Open a fresh private browser window.
2. Open Network and enable Preserve log.
3. Keep request bodies and token responses out of screenshots.
4. Perform signup, login, hard reload, protected query, OAuth authorization,
   consent, MCP call, revocation, logout, and Back navigation.
5. Inspect cookie attributes in Application/Storage without copying values.
6. Confirm no credential appears in URLs, storage, page source, rendered markup,
   console, or analytics.
7. Confirm authorization and consent pages cannot be framed and are not cached.
8. Confirm logout and revocation change actual backend behavior, not only UI.
9. Repeat with a second user and cross-tenant identifiers.
10. Record only the safe evidence fields defined above.

## 10. CSRF, origin, and browser-channel attacks

Host a minimal attacker page on a distinct origin. Through a real browser, try:

- credentialed `fetch` to auth routes;
- HTML form POST to signup, signin, logout, consent, and administration routes;
- image/navigation GETs to any state-changing path;
- hostile `Origin`, `Referer`, and `Sec-Fetch-Site` combinations;
- method-override headers;
- callback-like paths with encoded slash, backslash, null, CRLF, dot segments,
  double encoding, and extra segments;
- cross-origin token exchange outside the exact supported public-client path;
- preflight requests with cookies, Authorization, DPoP, proxy authorization, a
  query string, wrong content type, or unapproved headers.

Expected result: only the exact reviewed identity-provider callback and public
client token-exchange exceptions work. Everything else remains same-origin or
fails closed without credential leakage.

## 11. Raw HTTP and proxy attacks

Playwright and `fetch` normalize some malformed traffic. Retain the existing
raw-wire suite and add deployed, bounded equivalents for:

- duplicate and conflicting `Content-Length`;
- malformed chunked encoding;
- GET/HEAD requests with bodies;
- invalid percent encoding and path confusion;
- duplicate singleton query/form keys after decoding;
- hop-by-hop header nominations through `Connection`;
- caller-supplied `Forwarded`, `X-Forwarded-*`, `Host`, client-IP, and internal
  BCN headers;
- oversized declared and streamed request bodies;
- oversized/truncated upstream responses;
- connection termination midway through a body;
- redirect responses that attempt to carry credentials to another origin;
- slow headers and stalled bodies within a strict total deadline.

Assertions must include status, bounded response shape, no unsafe redirect,
credential-free error/log behavior, and unchanged backend state.

## 12. OAuth attack matrix

RFC 9700 is the security baseline for the supported OAuth profile.

### 12.1 Authorization request

- [ ] Duplicate `client_id`, `redirect_uri`, `resource`, `scope`, `state`,
      `response_type`, challenge, and challenge-method fields fail.
- [ ] Percent-encoded duplicate names fail after decoding.
- [ ] Unknown ambiguous field names fail.
- [ ] Unregistered, wildcard, user-info-bearing, fragment-bearing, insecure
      non-loopback, and non-canonical redirects fail.
- [ ] Only exact registered resources and scopes are accepted.
- [ ] `plain`, lowercase, padded, short, or non-base64url PKCE challenges fail.
- [ ] Unsafe errors never redirect to an untrusted URI.
- [ ] Consent cannot be approved by a different browser session or user.

### 12.2 Authorization code

- [ ] Two processes racing one code produce exactly one success.
- [ ] Replay is denied.
- [ ] Wrong verifier, redirect, client, resource, or grant fails.
- [ ] Public and confidential client-authentication methods cannot be swapped.
- [ ] Duplicate Basic/form client authentication fails.
- [ ] Expired codes fail.
- [ ] Pre-provider guard failures preserve the code only where designed.
- [ ] Post-consumption failures burn the code only where designed.
- [ ] Injected signing failure rolls back or burns according to the reviewed
      invariant, never issuing an untracked token.

### 12.3 Token and resource server

Attempt substitution with:

- Convex session JWT at MCP;
- OAuth access token at the Convex session boundary;
- ID token as access token;
- access token for another issuer, resource, client, subject, session, or scope;
- wrong `typ`, `alg`, `kid`, `token_use`, `aud`, `azp`, or `client_id`;
- malformed, expired, not-yet-valid, overlong-lived, or conflicting raw claims;
- token signed by a retired/unknown key;
- token whose membership/delegation was removed after issuance.

Every failure must be credential-free. MCP challenges must advertise only the
supported protected-resource behavior.

### 12.4 Disabled surface

Keep probing disabled routes and grants. They must remain absent, not merely
undocumented:

- refresh tokens and `offline_access`;
- dynamic client registration;
- client credentials;
- implicit and password grants;
- token introspection;
- UserInfo;
- end-session;
- generic JWT token routes;
- provider access-token export;
- caller-selected upstreams or generic Convex function bridges.

## 13. MCP attack matrix

Use real Inspector and `mcp-remote`, then repeat the important requests against
the direct Convex transport.

- [ ] Nuxt and direct transports make the same authorization decision.
- [ ] Read-only scope cannot invoke write tools.
- [ ] Unknown tool names fail closed.
- [ ] Tool arguments are schema-validated and bounded.
- [ ] The caller cannot choose an arbitrary Convex function.
- [ ] No bearer token is passed as a Convex function argument.
- [ ] Resource and issuer binding are exact.
- [ ] Membership, delegation, consent, client, and session removal take effect
      at the next live check.
- [ ] A write’s live authorization check and state mutation share a transaction.
- [ ] Revocation is terminal for the tested client/session/consent state.
- [ ] MCP errors, Inspector output, and relay logs contain no tokens or secrets.

The existing external mode is one-shot and destructive. It requires an already
running fresh application plus the exact `BCN_MCP_TEST_*` topology and synthetic
credentials described in `test/TESTING.md`. It must never infer deployment or
cleanup ownership.

## 14. Real-backend concurrency and fault injection

Retain and expand evidence for:

- same logical ID created concurrently;
- unique-field collision;
- one-time consume with many workers;
- atomic increments under sustained contention;
- 1,001+ row count/update/delete behavior;
- create, consume, increment, update-many, trigger, and signing fault rollback;
- exact quota boundary with two independent processes;
- Nuxt/direct quota sharing;
- signed-IP isolation and forged-IP fallback;
- authorization-code race/replay;
- concurrent official JWKS rotations;
- membership removal racing a protected write;
- consent/client/session removal racing an MCP call.

Never retry a security-boundary request merely because the transport failed. A
mutation may have committed before the connection reset. Reconcile state through
a separate bounded evidence query or start a fresh isolated case.

## 15. Secrets, keys, and operational failure drills

Run on disposable infrastructure:

- [ ] Missing `SITE_URL`, Convex URL, or proxy secret fails during startup or
      before auth traffic.
- [ ] Nuxt/Convex public-origin mismatch fails closed.
- [ ] Different proxy-IP secrets fail without trusting caller IP.
- [ ] Malformed or unversioned Better Auth secret configuration fails.
- [ ] Add a new Better Auth encryption secret, verify old data, then retire the
      old secret only after the reviewed window.
- [ ] Rotate signing keys while sessions and OAuth tokens are active.
- [ ] Verify previous public keys remain for the complete grace period.
- [ ] Prove private JWK members never reach HTTP, logs, traces, exports, source
      maps, or operator responses.
- [ ] Deploy Nuxt before Convex and Convex before Nuxt; both orderings fail
      safely or remain compatible for the documented window.
- [ ] Simulate Convex unavailability, timeout, and truncated response.
- [ ] Roll back the Nuxt build and prove fingerprint mismatch is observable.
- [ ] Rehearse suspected secret compromise, rotation, revocation, notification,
      patch, and evidence preservation.

## 16. ZAP and generic DAST

Use OWASP ZAP only against the owned disposable lab.

Recommended progression:

1. proxy a manual/Playwright ceremony and run passive scanning;
2. import a sanitized URL inventory, never an unsanitized credential HAR;
3. run a constrained traditional/AJAX spider;
4. use requestor jobs for exact expected endpoints;
5. configure authentication with a synthetic low-privilege account;
6. run a narrow active policy excluding destructive administration and OAuth
   terminal-state routes;
7. fail CI on reviewed high-severity alerts and unexpected warnings;
8. manually triage every suppression with an owner, reason, and expiry.

ZAP is supplemental. It does not prove OAuth claim binding, code consumption,
Convex transaction atomicity, live membership, or MCP tool authorization.

### Proposed ZAP plan shape

```yaml
env:
  contexts:
    - name: bcn-security-lab
      urls:
        - ${BCN_SECURITY_LAB_ORIGIN}
jobs:
  - type: passiveScan-config
  - type: requestor
    parameters:
      user: synthetic-user
  - type: spider
  - type: passiveScan-wait
  - type: activeScan
    parameters:
      policy: bcn-nondestructive
  - type: report
  - type: exitStatus
```

This template is not safe until the exclusion list, authentication handling,
target validation, and evidence redaction are implemented and reviewed.

## 17. Browser, load, and soak coverage

### Browser matrix

- Chromium desktop;
- Firefox desktop;
- WebKit/Safari behavior;
- mobile WebKit/Chromium viewport and cookie behavior;
- two tabs and two isolated contexts;
- incognito/empty storage;
- hard reload and browser restart;
- clock skew around session/token expiry.

### Bounded load/soak

- sustained signup/signin failure traffic;
- many independent sessions and MCP clients;
- quota-window rollover;
- session and authorization-code expiry;
- repeated additive key rotation;
- deployment restart during active sessions;
- database contention and latency;
- cleanup of expired state;
- memory, log volume, and error-rate bounds.

Load testing must use separate synthetic IP/account buckets and a dedicated
deployment. Availability findings do not justify weakening authentication or
authorization checks.

## 18. Fuzzing roadmap

### Existing

`pnpm test:auth-fuzz` runs deterministic structured corpora for origins, callback
paths, proxy headers, duplicate/ambiguous OAuth fields, size limits, PKCE,
redirects, bearer syntax, token claims, streamed bodies, and timeout boundaries.
Failures contain a replay seed and a mode-restricted non-secret artifact.

### Proposed additions

- nightly rotating seeds while retaining reviewed seeds;
- automatic minimization into a reviewed regression input;
- coverage-guided targets for URL/form/header parsing;
- raw HTTP framing corpus against the disposable Nuxt server;
- differential parsing between Node Fetch, Nitro/h3, Vercel, and Convex ingress;
- OAuth state-machine sequence generation;
- MCP JSON-RPC sequence and bounded argument generation;
- browser navigation/cookie state-machine fuzzing;
- corpus coverage metrics by invariant, not only line coverage.

Any generated failure must be reproduced deterministically before it becomes a
release blocker or public claim.

## 19. LLM security-agent operating model

An LLM agent is useful for persistence, breadth, minimization, and converting
findings into tests. It is not a security authority and must not hold production
credentials or approve its own stable release.

### 19.1 What an agent may do

- inspect the threat model, code, tests, dependency graph, and diffs;
- run existing local and disposable-environment gates;
- generate synthetic accounts and inputs inside the authorized lab;
- inspect safe structured logs and aggregate database evidence;
- use Playwright, real OAuth/MCP clients, and constrained ZAP plans;
- compare behavior across Nuxt/direct and source/tarball boundaries;
- minimize a failing sequence;
- write a regression test that fails before the fix;
- propose the smallest foundational correction;
- run neighboring and complete release gates;
- prepare a bounded human-readable evidence report;
- identify uncertainty and stop when authority or evidence is missing.

### 19.2 What an agent must not do

- scan infrastructure not explicitly owned and placed in scope;
- test production or shared staging destructively;
- request, reveal, persist, or paste secrets;
- upload unsanitized traces, HARs, snapshots, or logs;
- weaken a gate merely to make it green;
- retry an ambiguous one-time security operation;
- infer that it owns external cleanup;
- silently add compatibility paths or a second source of truth;
- declare the product “secure,” “certified,” or penetration-tested;
- resolve and approve its own high-severity finding without independent review;
- publish npm packages or approve stable release without the protected human
  process.

### 19.3 Agent task contract

Give the agent an explicit task such as:

```text
Target: exact pkg.pr.new URL and disposable deployment identifiers
Authority: read/run lab tests; create synthetic lab data; no production access
Invariant: removed membership denies the next MCP write despite a live token
Evidence: request IDs, statuses, aggregate row counts; no credentials or bodies
Stop conditions: topology mismatch, non-empty deployment, missing cleanup owner,
                 credential exposure, or ambiguous commit state
Completion: failing attack is denied, DB unchanged, regression test added,
            exact candidate rerun green, residual risk documented
```

### 19.4 Agent review rotation

For high-risk changes, use distinct review passes:

1. architecture/invariant review;
2. OAuth/protocol review;
3. proxy/raw-HTTP review;
4. Convex atomicity/authorization review;
5. package/release/provenance review;
6. maintainability/simplification review.

Agents may disagree. Preserve the evidence and have a human security owner
resolve release-significant disagreement.

## 20. Human-only security responsibilities

- approve lab scope and destructive authority;
- enter secrets directly into trusted secret managers;
- review any evidence that might contain credentials;
- review ZAP suppressions and accepted risks;
- verify deployment, DNS, TLS, ingress, CSP, and sibling-subdomain policy;
- conduct or commission independent source and black-box review;
- review licensing/provenance;
- own vulnerability disclosure and incident communication;
- approve protected cloud rehearsal and npm publication;
- decide whether residual risk is acceptable for beta or stable.

Stable release requires an independent human auth/security reviewer who was not
the primary implementer. An LLM review is additional evidence, not a substitute.

## 21. Finding and regression workflow

When anything surprising happens:

1. **Stop mutation** if the environment or credentials are uncertain.
2. **Classify** the affected asset, boundary, attacker, and impact.
3. **Capture safe evidence:** commit, artifact hash, deployment, request ID,
   status, aggregate state, test/corpus/seed.
4. **Reproduce** on a new disposable case.
5. **Minimize** the input or sequence without removing the failure.
6. **Write a failing regression test.** Confirm it fails before the fix.
7. **Find the violated invariant.** Do not patch only the observed symptom.
8. **Fix simply:** delete or tighten before adding wrappers, modes, or state.
9. **Run adjacent negative tests** and add a security mutant when useful.
10. **Rebuild the immutable candidate.** Previous tarball evidence is obsolete.
11. **Repeat external proof** when the affected boundary includes deployment.
12. **Document residual risk** and obtain independent review for high severity.

### Safe finding record

```text
Finding ID:
Severity and rationale:
Invariant:
Attacker prerequisites:
Commit and artifact SHA-256:
Disposable deployment IDs:
Minimal reproduction command/seed:
Expected result:
Actual bounded result:
Database state before/after:
Regression test:
Fix commit:
Independent reviewer:
Residual risk:
```

## 22. Automation cadence

### Every pull request

- `pnpm check`;
- fuzz and mutation tests;
- secret/export surface static checks where relevant;
- dependency, provenance, schema, boundary, and workflow contracts;
- targeted review of changed security invariants.

### Every package preview candidate

- `pnpm release:prepare` from a clean commit;
- exact artifact verification;
- all maintained clean consumer builds;
- real pinned Convex backend;
- full E2E and proxy DAST;
- OAuth/MCP real clients and selected conformance;
- pkg.pr.new install into a separate clean app;
- Playwright external security project;
- manual DevTools ceremony;
- destructive external-disposable MCP proof;
- cleanup and zero/unexpected-state evidence.

### Nightly or weekly

- advisory/upstream drift;
- rotating fuzz seeds;
- browser matrix;
- constrained ZAP scan;
- bounded load/soak and quota rollover;
- stale security-exception and suppression review;
- key/revocation drill on disposable infrastructure.

### Before prerelease publication

- protected cloud-staging fingerprint and clean-state rehearsal;
- exclusive ingress/lease proof;
- real session JWT accepted by the named Convex deployment;
- lockout/reset, OAuth code, quota, and JWKS races;
- zero-state cleanup proof;
- protected npm trusted publishing and registry byte comparison;
- named Security Owner and licensing reviewer (the same solo maintainer may fill both);
- enabled private vulnerability reporting, with no claim of independent review.

### Before stable

- compatible Better Auth stable tuple;
- independent human source review;
- independent black-box OAuth/MCP assessment;
- human licensing/provenance review;
- external Vercel/Convex rehearsal on the exact candidate;
- incident and forward-fix rehearsal;
- no unresolved critical/high finding or P0/P1 release blocker;
- every accepted lower risk has owner, reason, expiry, and compensating control.

## 23. Metrics that matter

Do not optimize for raw test count. Track:

- security invariants with positive, negative, and mutation evidence;
- percentage of critical boundaries exercised through exact candidate bytes;
- real-backend versus mock-only guarantees;
- attack cases asserting post-failure database state;
- time to reproduce and permanently regress a finding;
- stale suppressions, advisory exceptions, and accepted risks;
- dependency/upstream review freshness;
- browser/client/backend matrix coverage;
- secret-sentinel surfaces covered;
- cleanup completeness;
- independent-review findings and closure quality;
- mean time to rotate/revoke after a compromise drill.

## 24. Prioritized roadmap

### P0 — finish the real preview loop

- [ ] Complete exact-candidate `release:prepare`.
- [ ] Publish the commit-addressed pkg.pr.new preview through a PR.
- [ ] Build the clean external consumer from that URL.
- [ ] Deploy fresh Convex plus fixed-origin Vercel preview.
- [ ] Run the existing external-disposable OAuth/MCP proof.
- [ ] Add the Playwright multi-role browser security project.
- [ ] Perform and record the manual DevTools ceremony.
- [ ] Fix every candidate defect and repeat from a new immutable artifact.

### P1 — broaden automated adversarial evidence

- [ ] Implement the thin `security:lab:*` facade.
- [ ] Add Firefox and WebKit external runs.
- [ ] Add constrained ZAP automation.
- [ ] Add membership/consent/client/session removal races around MCP writes.
- [ ] Add bounded load, quota rollover, expiry, and repeated key rotation.
- [ ] Add deployed configuration mismatch and partial-outage drills.
- [ ] Add safe non-secret evidence JSON with schema validation.

### P2 — reduce unknown unknowns

- [ ] Add coverage-guided parser/raw-HTTP fuzzing.
- [ ] Run an independent human auth/OAuth assessment.
- [ ] Run a separate black-box test with no source guidance.
- [ ] Refactor large security-critical files only after preview behavior is
      characterized and invariant tests pin behavior.
- [ ] Establish a responsible-disclosure or funded bug-bounty path after beta.
- [ ] Re-run the complete program for Better Auth 1.7 stable.

## 25. Release decision

The correct claim is never “Fort Knox” or “unhackable.” The defensible claim is:

> This exact release was tested against named security invariants using source,
> mutation, deterministic fuzz, real-backend concurrency, raw HTTP, browser/SSR,
> real OAuth/MCP clients, clean package artifacts, and a disposable external
> deployment. Remaining risks and human review status are documented.

### Beta-ready

- exact candidate graph green;
- clean pkg.pr.new consumer and external deployment green;
- no unresolved critical/high issue;
- diagnostics and cleanup verified;
- limitations and RC dependency status explicit.

### Stable-ready

- all beta evidence repeated on the stable dependency tuple;
- protected publication and cloud rehearsal green;
- independent human security and licensing review complete;
- no unresolved stable blocker;
- incident, rotation, notification, and forward-fix procedures rehearsed.

## 26. References

Repository sources of truth:

- `SECURITY.md` — supported tuple, architecture, invariants, residual risk, and
  reporting policy;
- `test/TESTING.md` — exact test commands and fixture ownership;
- `RELEASING.md` — immutable artifacts, previews, protected staging, and npm
  publication;
- `plan.md` — phase acceptance criteria and external/human blockers;
- `security/asvs-5.0.0-l2-evidence.json` — machine-readable ASVS evidence;
- `security/upstream-convex-better-auth.json` — imported-source provenance and
  upstream review.

External primary guidance:

- OWASP ASVS 5.0: <https://owasp.org/www-project-application-security-verification-standard/>
- OWASP Web Security Testing Guide: <https://owasp.org/www-project-web-security-testing-guide/latest/>
- OAuth 2.0 Security Best Current Practice, RFC 9700:
  <https://www.rfc-editor.org/info/rfc9700/>
- Playwright authentication and multiple roles:
  <https://playwright.dev/docs/auth>
- Playwright network observation/interception:
  <https://playwright.dev/docs/network>
- OWASP ZAP Automation Framework:
  <https://www.zaproxy.org/docs/desktop/addons/automation-framework/>
