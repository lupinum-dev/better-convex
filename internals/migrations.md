# Active migrations

## Unsupported subscriptions with official MCP SDK 2

- **Why it exists:** With `maxSubscriptions: 0`, official SDK 2.0.0 reports
  `subscriptions/listen` as a subscription capacity error (HTTP 200, `-32603`).
  The finite-response server does not offer subscriptions. After SDK validation,
  `rejectUnavailableSubscription` corrects only that exact classified response
  to HTTP 404 and `-32601`, preserving its request ID and other SDK errors.
- **Introduced:** 2026-09-15.
- **Dependencies:** The pinned official SDK 2 and the finite-response MCP profile.
- **Removal condition:** Select a reviewed SDK with an official way to disable
  subscriptions that itself returns HTTP 404 and `-32601`. Verify unchanged
  header, version, correlation and closed-capability regressions; remove the
  response correction and this entry together.
- **Tracking issue:** [Release-completion review #143](https://github.com/lupinum-dev/better-convex/pull/143).

## MCP SDK missing protocol-version header rejection

- **Why it exists:** Official server SDK 2.0.0 accepts a modern request whose
  body contains its protocol version even when the required HTTP
  `MCP-Protocol-Version` header is absent. That request can invoke an application
  tool. The [2026-07-28 HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation)
  requires HTTP 400 and JSON-RPC `HeaderMismatch` (`-32020`). The bounded
  transport rejects the missing header after authentication, parsing only a
  safe correlation ID on that terminal error path. The SDK still owns version
  support, envelope validation, and dispatch.
- **Introduced:** 2026-09-14.
- **Dependencies:** Consumers of `handleMcpRequest` using the pinned official
  server SDK 2.0.0, including the isolated Luis ChatGPT pilot.
- **Removal condition:** Upgrade to a reviewed published official SDK version
  that rejects absent and empty protocol-version headers with HTTP 400 and
  `-32020` before tool execution. Verify this with the unchanged regression
  suite in `test/unit/mcp-header-contract.test.ts`, then remove
  `missingMcpProtocolHeaderResponse`, its handler call, and this entry together.
  Keep the protocol regression tests after removing the guard.
- **Tracking issue:** [Release-completion review #143](https://github.com/lupinum-dev/better-convex/pull/143).

## Beta.3 user-generation backfill

- **Why it exists:** Populated beta.3 Better Auth user rows do not contain the
  generation field required by beta.4 and later.
- **Introduced:** 2026-09-10.
- **Dependencies:** Three pre-customer application-owned beta.3 components need
  one reviewed in-place user migration after their legacy sessions are deleted.
  User IDs, accounts, passwords, and application references must remain stable.
- **Removal condition:** Remove the operator function, tests, public procedure,
  and this entry after all three production components run the strict target
  schema and their rollback windows close.
- **Tracking issue:** Create the issue before publishing the migration release.

## Optional OAuth renewal and immutable consent binding

- **Why it exists:** The previous authorization-code-only profile issued JWTs
  without immutable consent identity. The optional renewable profile binds new
  JWTs through signed `bcn_grant_id`, private `OAuthLiveAccess.grantId`, and the
  canonical consent row ID. Its refresh rows receive immutable `bcnConsentId`.
- **Introduced:** 2026-09-14.
- **Dependencies:** Existing authorization-code-only clients, including the original
  isolated Luis read client. The newer Luis synthetic pilot already uses renewal
  and has refresh rows; inspect its actual component state before migration. Their already-issued unbound JWTs retain at most
  their original 600-second bearer window. Revoking and recreating the same
  consent can restore those legacy tokens during that window; it cannot restore
  a new bound token. Do not describe that transition as permanent per-grant
  revocation until the window has elapsed.
- **Cutover:** Deploy the generated component schema and metadata together and
  regenerate application component bindings for the additive private refresh
  parent argument. Preserve the optional `grantId` in private application
  principal validators. The previously supported profile issued no refresh
  rows; any experimental existing rows must be normalized to the new nullable
  field before schema validation. A null `bcnConsentId` fails closed and must
  never be rebound to current consent. Obtain fresh consent for `offline_access`
  or additional operation scopes; do not widen existing client grants.
- **Rollback:** Disable renewal and the MCP endpoint, revoke affected clients,
  and clear their experimental refresh rows before reverting schema/artifacts.
  Preserve users, credentials, and unrelated browser sessions. A retained
  bound token must not be admitted through a weaker old validator.
- **Removal condition:** Remove acceptance of unbound access-token claims and
  the optional `grantId` compatibility shape only after all known consumers use
  consent-bound issuance and their last legacy token window has elapsed. Keep
  nullable stored refresh binding until no experimental legacy rows remain.
  Remove this entry together with the retired compatibility path; keep the
  revocation/reconsent regression tests.
- **Tracking issue:** [Release-completion review #143](https://github.com/lupinum-dev/better-convex/pull/143).
