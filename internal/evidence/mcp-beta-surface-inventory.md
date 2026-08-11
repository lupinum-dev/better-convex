# MCP beta surface and deletion inventory

Inventory target: `vnext` at `da3d50cd8794`, whose runtime is unchanged from the certified
`better-convex-nuxt@0.7.0-beta.1` tag except for internal documentation. This document freezes the
beta MCP behavior as historical evidence. It is not a roadmap to extend that implementation.

## Result

The repository currently proves **two separate MCP trust models through two separate server
topologies**:

1. a delegated-human OAuth resource whose public Nuxt endpoint proxies to a hand-written Convex
   `2025-11-25` subset; and
2. a private service-actor Nuxt server built with `@nuxtjs/mcp-toolkit`, which forwards both a service
   bearer and a separate server secret as Convex function arguments.

These are valuable security evidence, but they are not the vNext architecture. The delegated starter
contains a hand-written wire implementation, while the private starter contains the exact bearer/secret
bridge the RFC rejects. Neither may become a shared abstraction. Phase 1 must implement the same neutral
application behavior with the official SDK in each candidate topology, select one, migrate any retained
trust-model example, and delete both superseded protocol paths.

## Product and transport inventory

| Boundary                                            | Current responsibility                                                                                                                                                                                                                    | vNext disposition                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/runtime/utils/auth-config.ts`, `src/module.ts` | Public beta switch `auth.mcp`; registers fixed `/mcp` and protected-resource metadata routes.                                                                                                                                             | Keep frozen until topology selection. Replace the beta switch with the admitted MCP package integration; do not add version/topology options.                                                |
| `src/runtime/server/mcp/topology.ts`                | Derives public resource, Better Auth issuer, metadata, and fixed Convex action from trusted config. Publishes only `mcp:read` and `mcp:write`.                                                                                            | Conditional. Preserve config-derived authority and exact resource binding; delete if Nitro wins, otherwise replace beta constants with selected SDK integration.                             |
| `src/runtime/server/mcp/protected-resource.ts`      | GET/HEAD RFC 9728 metadata, public five-minute cache, no route when disabled/misconfigured.                                                                                                                                               | Conditional on selected topology/adaptor placement. Preserve the standards behavior, not this Nuxt-local implementation by default.                                                          |
| `src/runtime/server/mcp/route.ts`, `proxy.ts`       | Fixed-target Nuxt-to-Convex proxy. Allows GET/POST/DELETE, forwards an allowlist including opaque `Authorization`, bounds JSON requests to 64 KiB and non-SSE responses to 1 MiB, rejects encodings/redirects, and uses bounded timeouts. | Conditional on Convex-native topology. If Nitro wins, delete. If Convex wins, use only as a thin official-SDK transport boundary and remove obsolete session headers after final-spec proof. |
| `src/runtime/convex-auth/oauth-resource.ts`         | Uses the pinned Better Auth resource client for JOSE/JWKS verification, then re-decodes the signed compact token and enforces BCN's exact access-token claims.                                                                            | Preserve the token-class and exact-binding invariants for the Better Auth adapter. The provider-neutral MCP base must not depend on it.                                                      |
| `src/runtime/convex-auth/oauth-security.ts`         | Hardens the optional Better Auth OAuth authorization-server role: grant/profile/storage/claims/admin callbacks, timeouts, metadata and parsing.                                                                                           | Preserve for Nuxt/Better Auth deployments until an intentional dependency change. Do not move it into provider-neutral MCP core.                                                             |

The root MCP runtime is 337 lines of topology, metadata, route, and proxy code. It intentionally does
not parse JSON-RPC or select a Convex function.

## Delegated-human OAuth starter

### Wire surface

| File                                              | Frozen behavior                                                                                                                                                                                                                                                                | Replacement/deletion                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `starters/mcp-oauth-agent/convex/mcp/protocol.ts` | Hand-written JSON-RPC parser fixed to `2025-11-25`; accepts `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`; rejects batches, unknown/extra keys, invalid IDs/arguments, non-JSON/encoded/over-64-KiB input; builds JSON-RPC results/errors. | **Delete** after the chosen official SDK path passes equivalent and newer conformance. Never extend across the July protocol.                                                                  |
| `starters/mcp-oauth-agent/convex/mcp.ts`          | Public Convex HTTP action; verifies bearer before method/body handling; POST-only upstream; performs the complete fixed tool switch; converts expected application failures to bounded HTTP codes.                                                                             | **Delete/replace** with explicit official-SDK registration in the chosen topology. Keep explicit tool-to-application mapping.                                                                  |
| `starters/mcp-oauth-agent/convex/mcp/security.ts` | Strict single `Authorization: Bearer` compact JWT extraction; calls BCN's Better Auth verifier with exact issuer/resource/lifetime/scopes.                                                                                                                                     | Replace with provider-neutral access context plus optional Better Auth verifier adapter. Preserve header-only transport and coarse public failures.                                            |
| `starters/mcp-oauth-agent/convex/mcp/policy.ts`   | Serializes the verified delegated principal and recomputes session, user, client, resource, consent, membership, delegation, role, project, and approval state.                                                                                                                | Keep the **application-owned live authorization pattern**, not the starter's universal types or CMS-shaped approval vocabulary. Move no role/permission logic into Better Convex.              |
| `starters/mcp-oauth-agent/convex/mcpTools.ts`     | Five internal mutations load a single live snapshot, apply scope ceilings and rate limits, then read/write application state. Approval is consumed in the delete mutation.                                                                                                     | Migrate the neutral operation pattern into fixtures. Retained starter operations must use the selected MCP implementation; remove principal serialization plumbing that is no longer required. |

The hand-written delegated implementation above is 1,095 lines including live policy and application
operations. Its wire parser/dispatcher/security portion is 513 lines. LOC is not itself a decision; the
ownership split is. The official SDK must own wire behavior, while application functions continue to
own live authorization and effects.

### Exact beta operations

| Tool                              | Scope ceiling | Effect                                                                                              |
| --------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `projects.list`                   | `mcp:read`    | Return at most 100 active projects after current membership/delegation checks.                      |
| `projects.create`                 | `mcp:write`   | Ordinary transactional project creation with current role/delegation checks and rate limit.         |
| `projects.delete.preview`         | `mcp:write`   | Read-only application preview. This is starter policy, not a generic requirement for writes.        |
| `projects.delete.requestApproval` | `mcp:write`   | Create a short-lived application-owned approval row for the demo's destructive operation.           |
| `projects.delete.execute`         | `mcp:write`   | Recheck all authority and bound approval state, consume approval, then soft-delete transactionally. |

The supported protocol surface has no resources, resource templates, prompts, MCP Apps, URL
elicitation, replacement Tasks extension, sampling, roots, subscriptions, or automatic Convex-function
exposure. `run-mcp-conformance.mjs` certifies only `server-initialize`, `ping`, and `tools-list` for
`2025-11-25`; repository tests separately cover fixed `tools/call` behavior.

## Private service-actor starter

| Boundary                                                                    | Current responsibility                                                                                                                                                                       | vNext disposition                                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `starters/mcp-agent/server/mcp/index.ts`, `server/mcp/tools/**`             | Nuxt MCP Toolkit discovers seven file-defined tools and supplies the v1 official SDK transport indirectly.                                                                                   | Retain only as historical topology evidence. Migrate a still-useful private-service example to the selected official SDK package; delete Toolkit dependency and file-discovery wrappers.   |
| `starters/mcp-agent/server/utils/mcpProjectTools.ts`                        | Parses one bearer from Toolkit request metadata, validates tool input, creates `ConvexHttpClient`, and calls public Convex queries/mutations with both `serverSecret` and raw `bearerToken`. | **Delete** after selected-topology migration. Never expose this bridge as Trusted Calls or a general adapter.                                                                              |
| `starters/mcp-agent/convex/access.ts`                                       | Validates the shared server secret and hashes/loads the forwarded bearer on every call; rechecks actor, credential, tenant, and role.                                                        | Delete `requireMcpServerCall` and raw transport arguments. Preserve current application authorization in selected topology wrappers.                                                       |
| `starters/mcp-agent/convex/projects.ts`, `approvals.ts`                     | Application-owned project operations, rate limits, audit, soft deletion, request idempotence, and a single-use human approval workflow.                                                      | Retain/migrate only as application example semantics. Do not extract RBAC, preview, approval, workflow, or tables into Better Convex.                                                      |
| `starters/mcp-agent/convex/serviceActors.ts`, `agentCredentials.ts`, schema | Creates and revokes application-owned service actors and hashed bearer credentials.                                                                                                          | A proving consumer may retain them as application state. They do not define provider-neutral MCP machine authentication; Phase 8 remains separately gated on the official OAuth extension. |

This starter's raw bearer is not an OAuth delegated token and is never converted into a Convex session
JWT. Nevertheless, forwarding it and `MCP_SERVER_SECRET` through general Convex argument values is the
specific transport coupling vNext must remove. The useful invariants are current credential/actor/tenant
checks, rate limits, bounded inputs, audit, idempotence, and transactional approval consumption.

## Security invariants to carry forward

1. One exact public MCP resource is derived from trusted configuration; requests cannot select an
   upstream, function, issuer, or audience.
2. OAuth bearer values appear only in the `Authorization` header, terminate at the logical resource,
   and never enter Convex function arguments, responses, diagnostics, or stored state.
3. Token verification enforces exact issuer, audience/resource, access-token class, client binding,
   lifetime, algorithm, and allowlisted scopes; session JWTs are a different token class.
4. Scope is only a delegated ceiling. Every effect rechecks current application authority and canonical
   resource state in the effect's mutation.
5. Tool names, schemas, descriptions, and function mappings are explicit and application-authored.
   Caller input is never interpreted as a Convex function reference.
6. Bounds, content type, encoding, origin, method/path, abort, timeout, redirect, header, and response
   rules fail closed before or around protocol execution.
7. Expected domain outcomes are bounded and structured; infrastructure failures and raw causes remain
   opaque. Diagnostic surfaces are allowlisted and credential-free.
8. Retry/idempotency/approval truth is application-owned. Tool annotations and host UI never grant
   authority. Ordinary writes stay ordinary in vNext.
9. Any retained service-actor example rechecks current credential, actor, tenant, and permissions, but
   does so through the selected MCP topology rather than a public bearer/server-secret argument bridge.

## Exact deletion plan after topology proof

### Unconditional replacements

- Delete `starters/mcp-oauth-agent/convex/mcp/protocol.ts` and the manual dispatch lifecycle in
  `convex/mcp.ts` once official-SDK parity passes.
- Delete `@nuxtjs/mcp-toolkit`, `server/mcp/tools/**`, and `server/utils/mcpProjectTools.ts` after the
  private starter uses the selected official implementation.
- Delete `serverSecret` and raw service `bearerToken` from application Convex function arguments and
  delete `requireMcpServerCall` after the replacement proof passes.
- Replace or delete the current three-scenario `run-mcp-conformance.mjs` relay when the selected SDK and
  final conformance suite can test the real protected endpoint directly. Do not preserve two runners.

### Topology-dependent deletions

- If Nitro wins: delete `src/runtime/server/mcp/proxy.ts`, its Convex target topology, and the Convex
  hand-written MCP action.
- If Convex-native wins: delete the Nuxt Toolkit server and keep only the smallest fixed Nuxt relay or
  metadata adapter required by the accepted topology. The official SDK still owns the Convex-side wire.
- The topology ADR must name the final disposition of both starters; a retained starter demonstrates a
  trust model through the one selected implementation, never a second server stack.

### Code that is not a shared extraction target

- roles, memberships, service actors, credentials, consents, delegations, approval rows, projects,
  activity/audit records, and soft-delete policy;
- preview/request/approve/execute orchestration as a universal command protocol;
- the fixed `mcp:read`/`mcp:write` vocabulary;
- a universal principal union or authorization adapter;
- automatic exposure of Convex functions.

## Executed baseline evidence

Executed from `vnext` on 2026-07-20:

```text
pnpm exec vitest run --project=mcp
# 9 files, 79 tests passed

pnpm --dir starters/mcp-agent exec vitest run convex
# 10 files, 84 tests passed

pnpm --dir starters/mcp-agent exec vitest run server/mcp-tools-convex.test.ts
# 1 file, 25 tests passed
```

The package-local starter dependencies were installed from its frozen lock with lifecycle scripts
disabled before the latter two commands. The full `pnpm --dir starters/mcp-agent test` command was also
attempted, but its Nuxt Toolkit integration setup produced no result after starting Vitest and was
interrupted rather than reported as passing. That integration is already covered by the immutable beta's
exact release evidence; it is not used as proof for this inventory task. Phase 1's official-SDK probes
will replace this topology-specific test rather than debugging and extending the superseded server.

## Freeze rule

Until the official-SDK topology decision is accepted, beta MCP runtime changes are limited to verified
security or correctness fixes. No new method, resource, tool abstraction, capability, protocol revision,
extension, topology option, auth bridge, or compatibility path may be added to these surfaces.
