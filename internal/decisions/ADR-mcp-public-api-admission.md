# ADR: minimal MCP public API admission

- Status: accepted for experimental prerelease
- Date: 2026-07-22
- Protocol basis: locked `2026-07-28` release candidate
- SDK basis: exact `@modelcontextprotocol/server@2.0.0-beta.5`
- Stabilization gate: final specification and SDK reconciliation under `G-001`

## Outcome

Admit one small integration seam. Better Convex will adapt an official MCP server factory to the
selected Convex HTTP runtime while keeping credentials and provider-private authorization references
out of application callbacks.

The application continues to create `McpServer` directly and calls official `registerTool` and
`registerResource` APIs directly. Better Convex does not create a second registry or tool-definition
abstraction. The neutral package migration admitted one `runMcpTool` callback boundary because the
official SDK deliberately serializes unexpected callback throws and cannot emit application-safe
diagnostics without seeing the callback failure. The helper only returns an existing official
`CallToolResult`; it owns no registration, schema, operation mapping, or domain result vocabulary.

Candidate surface for `P5-002` and `P5-003` proof:

```ts
export interface McpAccessContext {
  readonly issuer: string
  readonly subject: string
  readonly clientId: string
  readonly resource: string
  readonly scopes: readonly string[]
}

export interface McpAccessVerifier {
  verifyAccessToken(token: string, expectedResource: URL): Promise<VerifiedMcpAccess>
}

export const mcp = createConvexMcpHandler({
  resource: 'https://deployment.example/mcp',
  verifier,
  authorization: {
    mode: 'oauth',
    metadata: oauthMetadata,
  },
  serverInfo: { name: 'my-app', version: '0.1.0' },
  configureServer(ctx, access, _request, server) {
    server.registerTool(/* official SDK API */)
  },
})

export const handleMcp = httpAction((ctx, request) => mcp.fetch(ctx, request))
```

Names and the verifier's non-public result shape remain subject to implementation proof. No other
helper is admitted by this decision.

## Preconfigured bearer credentials

Ginko supplied the required materially different credential model: an application-managed API key
already configured in the MCP client, rather than a token obtained through MCP OAuth discovery. The
official client permits callers to supply externally managed bearer tokens, while the authorization
specification requires RFC 9728 metadata when the server participates in OAuth discovery. Advertising a
fictional authorization server or relabelling an API key as OAuth would therefore be incorrect.

Admit one explicit `preconfigured-bearer` authorization profile. It uses the same header-only bearer
verification, exact resource binding, scope ceiling, sanitized challenge, transport boundary, and access
context as OAuth mode, but serves no OAuth metadata and emits no `resource_metadata` challenge parameter.
The application supplies one canonical HTTPS credential issuer for provenance. This is not interactive
authorization, token exchange, or an OAuth compatibility mode.

The two profiles are a discriminated union. OAuth metadata cannot be partially combined with a
preconfigured credential, and switching modes is an intentional construction-time decision. This adds no
token store, credential format, provisioning API, provider dependency, or application authorization
policy.

## Direct official SDK comparison

The exact SDK already provides and must continue to own:

- `McpServer`, tool/resource registration, Standard Schema integration, and output validation;
- `createMcpHandler`, modern per-request serving, protocol classification, and result projection;
- protocol-era classification, routing-header/body agreement, discovery, and result metadata;
- `OAuthTokenVerifier`, bearer parsing, expiration enforcement, RFC 9728 challenges, and metadata
  builders;
- MCP error classes, result types, cache hints, and future input-required results.

Wrapping those APIs would duplicate a registry, protocol lifecycle, or error model and fails admission.

The admitted Convex-native profile intentionally selects the SDK's strict modern entry and finite JSON
responses. Its per-request server lifetime cannot truthfully own legacy SSE or stateful subscription
delivery, so those capabilities are rejected instead of bridged through another registry or transport.

The direct SDK does not solve three selected-runtime problems:

1. `AuthInfo` deliberately contains the raw bearer token and untyped `extra` metadata. Passing it to
   application tool closures makes accidental token or provider-reference propagation easy.
2. `createMcpHandler` deliberately performs no Origin/Host validation, bearer verification, body
   bounding, or response cache policy. Every Convex consumer would otherwise repeat the same security
   boundary around the fetch handler.
3. Applications need a canonical serializable identity-provenance shape for explicit internal Convex
   operations, while the SDK's `AuthInfo.resource` is a `URL`, scopes are mutable, and issuer/subject
   live in provider-specific metadata.

The admitted adapter fills only those gaps. It composes the official bearer and handler APIs; it does
not parse JSON-RPC or implement protocol negotiation.

## Public API admission test

1. **Repeated problem.** Neutral notes and Ginko both need one bearer-consuming Convex HTTP action,
   safe identity provenance, fixed resource binding, request bounds, no-store responses, and explicit
   internal application calls without forwarding the token.
2. **Can official APIs solve it directly?** They solve protocol, registration, schema, bearer, and
   metadata behavior. They intentionally expose raw `AuthInfo` and leave the hosting boundary to the
   application, so direct use repeats security-sensitive glue.
3. **Can Better Convex be simplified instead?** Yes. Delete the existing starter parser/relay and use
   one adapter around the official SDK. Keep registration and domain outcomes in the official SDK;
   retain only the two-consumer, one-argument `runMcpTool()` opaque failure boundary.
4. **Two materially different consumers.** Neutral notes maps `(issuer, subject)` to tenant membership;
   Ginko maps it to an integration, current member/role, contract, and resource authority. Their domain
   policies and operations differ.
5. **Source of truth.** The adapter creates none. Tokens remain authorization-server state;
   application membership and effects remain application state.
6. **New persistent mechanism.** No table, cache, job, projection, registry, workflow, or key. The SDK
   server instance and private verification metadata exist for one request only.
7. **Derived-state lifecycle.** The access context is reconstructed from a freshly verified token on
   every request and discarded afterward.
8. **Invalid states prevented.** Canonical issuer, subject, client, resource, normalized scopes, and
   expiration are required before the application factory runs. Raw token and provider-private fields
   are absent from its type and value.
9. **Authorization owner.** The verifier owns credential validity and scope ceiling. Each explicit
   application operation reloads canonical actor/resource authority and owns the effect.
10. **Packed production proof.** Exact `@better-convex/mcp` bytes must run in a deployed Convex fixture
    with both Better Auth and an external verifier, then pass neutral and Ginko read/write matrices.
11. **Deleted code.** The selected replacement removes the supported hand-written MCP parser/relay,
    duplicate starter protocol code, active Nitro fallback, and Ginko's HMAC/server-caller bridge for
    migrated operations.
12. **Failure and rollback.** Before publication, hard-cut the package. If the final SDK or Convex
    runtime fails `G-001`, stop the package and restore the Nitro proof from `988b40f1` for a new
    evidence-based decision; never run peer implementations.

## Identity and private provider state

`McpAccessContext` preserves credential provenance; it does not assert an application actor. Issuer and
subject are joined as a tuple. Scopes are normalized ceilings, not roles or current grants.

Provider-owned session, consent, grant, or credential references are not members of the public access
context. A provider adapter may retain them in request-private state needed for a live provider check,
including inside an internal Convex authorization bridge. They must not enter tool arguments exposed by
the application, results, URLs, logs, Vue state, or MCP App messages. `P5-003`, `P5-004`,
and `P5-012` must prove the exact mechanism before the Better Auth adapter is admitted.

## Rejected helpers

- `withBetterConvex()` registration wrappers remain rejected. `runMcpTool()` is the narrower admitted
  exception for opaque unexpected failures; registration remains direct and official.
- Better Convex tool definitions or registries: second source of truth.
- automatic Convex function exposure or generic dispatcher: violates explicit operation mapping.
- `requireMcpScope()`: checking a normalized array does not justify a public function; revisit only if
  correct OAuth challenge/result projection requires shared behavior.
- generic structured-result/resource builders: official result types and application schemas suffice.
- roles, permissions, authorization callbacks, Commands, approval, workflow, Tasks, or idempotency
  APIs: application-owned or later gated phases.
- raw `AuthInfo`, verifier result, token, provider reference, Convex client, or action context exports:
  unnecessary authority and disclosure surface.
- configurable transport framework: begin with reviewed fixed bounds; admit options only from executed
  consumer evidence.

## RC status

The official project still labels the TypeScript v2 SDK as in development and the `2026-07-28`
specification as a release candidate. The RC is locked, so experimental implementation can proceed, but
the package must remain prerelease and must not claim final compliance. The final spec, changelog, SDK
bytes, and conformance suite are re-read after publication; material differences are handled by a hard
cut, not a compatibility shim.
