# Phase 6 interaction adversarial and disclosure proof — 2026-07-24

## Outcome

The private locked-RC implementation now passes the applicable URL-interaction security matrix in two
deliberately different application models:

- the neutral notes fixture uses direct same-issuer/subject confirmation;
- Ginko projects an inert locator into its existing application-owned publisher review queue.

The two models share no approval table, authorization policy, or interaction state machine. Better
Convex still exports no URL-interaction API.

## Neutral direct-interaction proof

BCN commit `58d57f3a` adds one canonical, indexed live MCP grant to the private Convex fixture. The same
record is read by MCP admission and by the mutation that confirms the high-impact effect. Revoking the
grant therefore blocks:

- a new authenticated MCP request;
- browser review retrieval;
- operation-key status recovery;
- final confirmation.

The grant carries the exact issuer, subject, client, and deployed resource binding. It contains no raw
token or provider session identifier. The initial test deployment correctly rejected a placeholder
resource; the fixture now receives the deployed `/mcp` resource explicitly when seeded rather than
weakening the resource comparison.

The deployed Convex/browser matrix also executes:

- capable and incapable clients;
- host `accept`, `decline`, and `cancel` input without treating any host action as authorization;
- forged request state;
- wrong client, issuer, resource, subject, and same subject under another issuer;
- malformed, traversing, oversized, and guessed locators;
- anonymous, forwarded, prefetched, and crawler-style GETs;
- member removal and owner-to-editor downgrade;
- target deletion and changed impact;
- expiry;
- synchronized confirmation, replay, one effect, and one identical receipt;
- lost-response status recovery;
- fixed-origin POST, CSRF rejection, private/no-store, strict-origin referrer policy, no framing, and
  no script-readable session.

The browser harness records the real upstream `303` and exact canonical `Location`. It suppresses only
Playwright's synthetic same-URL redirect race, then performs the canonical GET explicitly. This is a
test-harness correction; application behavior remains the real `303`.

## Ginko reviewer-queue proof

Ginko commit `04c67ce2` extends the canonical review tests without changing shipped package source:

- host `decline` and `cancel` leave the application review pending;
- revoking the initiating MCP credential blocks subsequent MCP status access and does not disclose the
  review identifier;
- a publisher downgraded to viewer cannot approve and no public projection is written.

Earlier commits `86bde379`, `185ae0ec`, and `2b66ca4f` already prove requester binding, idempotent
creation, same/different current publisher policy, stale impact, one transaction, competing decisions,
and one canonical result.

This is intentionally not the neutral same-user model. After creation, Ginko's canonical review may be
decided only by a currently authorized publisher under Ginko policy. Revoking the initiating MCP
credential terminates MCP access but does not erase the application record or confer/revoke reviewer
authority. The locator is navigation to the queue, not a transferable approval capability.

## Disclosure proof

The sentinel matrix introduces unique values at their real boundaries:

- raw bearer;
- provider-private reference;
- user-like subject PII;
- private tool argument;
- Better Auth/session fixtures;
- operation key;
- client, issuer, and subject bindings;
- opaque interaction locator.

It proves:

- application operations receive only the intended verified provenance and validated arguments;
- public MCP response bodies, allowlisted diagnostics, callback headers, and console methods contain
  no bearer, provider reference, subject PII, or private argument;
- production interaction HTML, response bodies, browser console/page errors, request diagnostics, and
  navigation URLs contain no credential or identity sentinels;
- the operation key never enters the interaction page or URL;
- the opaque locator appears only in the fixed interaction URL and canonical redirect, never in HTML,
  response bodies, errors, or general diagnostics;
- raw authorization, cookie, proxy authorization, and forwarded authorization headers remain absent
  from application callbacks.

## Executed evidence

BCN:

```text
CONVEX_E2E_AUTO_START=true pnpm exec vitest run \
  --config internal/labs/mcp-topology/convex/vitest.config.ts
```

Result: one deployed suite, four tests passed.

```text
pnpm exec vitest run \
  test/security/mcp-credential-passthrough.test.ts \
  test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-tool-errors.test.ts --reporter=dot
pnpm --filter @better-convex/mcp typecheck
pnpm exec oxfmt --check <seven touched files>
pnpm exec eslint <seven touched files> --max-warnings=0
```

Result: three files and fifteen tests passed; MCP typecheck, formatting, lint, and diff checks passed.

Ginko:

```text
pnpm --config.verify-deps-before-run=false exec vitest run \
  test/component/reviewRequests.test.ts \
  test/runtime/mcp.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Result: two files and fifteen tests passed; all contract, Convex, CMS, Studio, Nuxt preparation, and
production Vite type/build checks passed. The exact unpublished beta tarballs were restored from the
existing candidate content after pnpm correctly failed to resolve them from the public registry; no
manifest or lockfile changed.

## Remaining gate

`P6-014` must run this lifecycle through exact installed MCP/Nuxt candidate bytes from a clean commit.
Protected staging remains external. The final protocol adapter, terminology, and compliance claim remain
blocked on the published `2026-07-28` specification and compatible official SDK.
