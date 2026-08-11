# MCP OAuth resource-server laboratory — 2026-07-20

## Scope

This closes private-lab task `P1-010`. It proves that both independently mounted topology candidates can
compose the exact official SDK resource-server helpers with a provider-neutral verifier. It is not a
claim that the deterministic lab tokens are cryptographic credentials or that the prerelease SDK is a
stable public contract.

The single shared `oauth-fixture.ts` contains only test token records, an `OAuthTokenVerifier`, fixed
authorization-server metadata, and official-helper composition. The Convex test copies that exact source
into its disposable function directory before deployment; Nitro imports it directly. No Better Auth,
Nuxt session, role database, OAuth issuer implementation, or candidate transport abstraction is inside
the verifier.

## Official SDK surfaces exercised

- `requireBearerAuth` and `OAuthTokenVerifier` for header-only bearer verification;
- `OAuthError` / `OAuthErrorCode` for standards-shaped failures;
- `getOAuthProtectedResourceMetadataUrl` for path-aware challenge binding;
- `oauthMetadataResponse` for RFC 9728 Protected Resource Metadata and RFC 8414 authorization-server
  discovery.

The fake verifier mechanically enforces exact issuer, exact resource, access-token class, registered lab
client, expiry/revocation, and returns only verified `AuthInfo`. The official gate enforces the
`notes:read` scope and expiry again. Application handlers receive only the verified subject projected
from `AuthInfo`; current membership/role and every effect remain application-owned.

## Executed matrix

Both the production Nitro node server and freshly deployed local Convex HTTP action proved:

- path-aware Protected Resource Metadata names the exact MCP resource and one exact authorization
  server;
- authorization-server metadata advertises `authorization_code`, PKCE `S256`, public-client `none`, and
  no refresh, client-credentials, or dynamic-registration surface;
- missing credentials receive `401` with the exact `resource_metadata` challenge URL;
- expired, revoked, session-class, wrong-issuer, wrong-resource/audience, and unregistered-client tokens
  receive `401`;
- insufficient scope receives `403` and a `scope="notes:read"` challenge;
- a valid read-only delegated token can search but receives structured `ACCESS_DENIED` for write tools
  in both candidates;
- putting the valid token in the query string or JSON body, without the Authorization header, still
  receives `401`;
- the valid Alice and Bob tokens continue through official MCP initialize/tools/resources with current
  application authorization;
- every lab-token sentinel is absent from captured MCP responses, invalid-token bodies, and Nitro public
  browser assets.

The SDK `AuthInfo` necessarily retains the verified raw token inside the transport/auth layer. Tests and
source inspection prove that application operations receive a subject/principal only and that no token
is forwarded as a Convex function argument. A later public adapter must preserve this narrower boundary.

## Reproduction

```sh
pnpm exec vitest run --config internal/labs/mcp-topology/nitro/vitest.config.ts --reporter=verbose
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
pnpm exec vitest run test/unit/vnext-mcp-nitro-probe.test.ts test/unit/vnext-mcp-sdk-transport.test.ts test/unit/vnext-neutral-notes.test.ts --reporter=verbose
pnpm exec vue-tsc --noEmit --project tsconfig.json
```

Result on 2026-07-20: the production Nitro test, deployed local Convex test, and seven focused unit tests
passed; root type checking and focused lint passed. A first Convex attempt exposed that Convex module
filenames reject hyphens; the materialized filename was corrected to `oauth_fixture.ts`, after which the
fresh deployment passed. No runtime or security gate was weakened.

The 2026-07-22 integrated-topology rerun added operation-level write-scope ceilings to both candidates.
Current application membership and role still grant authority; OAuth scopes only narrow it.

## Boundaries of the claim

- The verifier is deterministic test infrastructure. Phase 5 still requires Better Auth and a genuinely
  external verifier with real cryptographic/interoperability evidence.
- Discovery metadata is exercised; no fake token endpoint or authorization server was invented. Real
  authorization-code, redirect, PKCE, consent, revocation, and code-concurrency evidence remains in the
  existing beta suite and later selected-topology staging work.
- The lab derives the local resource origin from the controlled Nitro process environment or managed
  Convex request origin. A public deployment must use one trusted configured origin and must not grant
  authority to an attacker-controlled Host header.
