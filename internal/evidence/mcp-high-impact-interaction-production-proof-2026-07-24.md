# MCP high-impact interaction production proof — 2026-07-24

## Outcome

Commit `9d6d0d7f` completes the neutral production proof for the private locked-RC interaction built in
`cfc2a020`.

The selected Convex-native topology now includes a neutral application page at the fixed origin
`https://notes.example.invalid/interactions/<opaque-locator>`. It is an application surface, not an
MCP host approval:

- an authenticated browser session maps to only an issuer and subject before the application query;
- `GET` performs only the canonical interaction query and never confirms or changes state;
- an explicit empty `POST` from the exact fixed origin invokes the canonical transactional
  confirmation;
- the application mutation rechecks current membership, role, target revision, and exact bounded
  impact before applying the effect;
- the result redirects to a canonical `GET`, while operation-key status recovery remains independent
  of the browser response.

The lab session adapter is private fixture code. It models an established application session and is
not a public authentication API.

## Response boundary

Every page and failure response sets:

```text
Cache-Control: private, no-store
Content-Security-Policy:
  default-src 'none';
  form-action 'self';
  frame-ancestors 'none';
  base-uri 'none';
  object-src 'none'
Referrer-Policy: strict-origin
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), display-capture=(), geolocation=(),
  microphone=(), payment=(), usb=()
```

The page contains no script, locator, operation key, token, cookie, client identifier, resource,
issuer, or raw error. Its form has no arguments; the current path supplies the opaque locator and the
HTTP-only application session supplies the actor.

## Executed adversarial evidence

The deployed local Convex and browser matrix proves:

1. anonymous access receives only `Sign in required`;
2. a different subject and the same subject under a different issuer receive the same generic
   unavailable response;
3. ordinary, prefetch, and crawler `GET`s render the exact summary, warning, and effect while leaving
   the operation pending;
4. missing and hostile origins, a different user, and any confirmation body cannot execute;
5. concurrent correct confirmations produce one application effect and one stored receipt;
6. a repeated confirmation remains idempotent;
7. a lost response is recoverable with the explicit operation key and returns the stored receipt;
8. changed impact renders `stale`; expired state renders `expired`; neither remains actionable;
9. a real Chromium page receives an HTTP-only `SameSite=Strict` session, renders the exact pending
   operation, sends the exact application Origin plus an origin-only Referer on the explicit POST,
   and renders the canonical applied state;
10. the page DOM, response bodies, browser console, page errors, MCP responses, and diagnostics contain
    none of the session or OAuth bearer sentinels.

The Playwright host routes the fixed HTTPS test origin to the deployed local Convex site and forwards
the browser's Origin, Referer, and Fetch Metadata unchanged. `strict-origin` keeps the opaque locator
out of Referer while allowing the exact Origin check to succeed. Intercepted same-URL redirects do not
receive a DNS-backed navigation in Chromium, so the harness verifies the exact `303` and `Location`
through the direct HTTP proof and then performs the canonical GET explicitly. This redirect handling
is a harness limitation, not a production fallback or alternate protocol.

## Exact installed-byte proof

The final matrix installed this immutable artifact into the temporary external Convex fixture:

```text
Package: @better-convex/mcp@0.1.0-beta.5
Source commit: f4fd5d02b814ce8ee46bbaec8c38c40ec1a80d12
Tarball:
  .release-artifacts/mcp/0.1.0-beta.5/better-convex-mcp-0.1.0-beta.5.tgz
SHA-256:
  cc45a4c9848bb17212f6c1795752bb725fa4ceec3fd15e59b0d42b03e83a2783
SRI:
  sha512-ct1flAjC61ndM2HyBrZiGfCxZNwHKfPwNTOCtJwoHZzP/RQusj86Lb0GYvAlzbKJzgwsuUrP8ovWq75QG3wS6g==
```

The fixture lock referenced the tarball and the existing candidate inspector compared installed
package bytes with its extracted contents before deployment.

Executed commands:

```text
pnpm exec eslint \
  internal/labs/mcp-topology/convex/interaction-browser-proof.ts \
  internal/labs/mcp-topology/convex/probe.test.ts \
  internal/labs/mcp-topology/convex/fixture/convex/interaction_page.ts \
  internal/labs/mcp-topology/convex/fixture/convex/interaction_page_contract.ts \
  internal/labs/mcp-topology/convex/fixture/convex/http.ts

pnpm typecheck

BCN_MCP_RELEASE_TARBALL=\
.release-artifacts/mcp/0.1.0-beta.5/better-convex-mcp-0.1.0-beta.5.tgz \
pnpm exec vitest run \
  --config internal/labs/mcp-topology/convex/vitest.config.ts
```

Focused lint and all module/server/fixture typechecks passed. The exact-tarball run passed one file and
four tests against the deployed local Convex backend and Chromium.

## Public-boundary result

A source scan found no private interaction page, operation table, RC `InputRequiredResult`,
`inputRequired`, `elicitUrl`, or `requestState` surface under `packages/`, `src/`, public tests, the root
manifest, or the lockfile. Public interaction API admission remains blocked until the final
`2026-07-28` specification and exact SDK are published and reconciled.

The next implementation task is to project these invariants onto Ginko's existing canonical review
records without adding another approval table or changing Ginko's requester/reviewer policy.
