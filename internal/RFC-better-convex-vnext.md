# RFC: Better Convex vNext — Vue-First, MCP-Native Platform

- Status: Proposed; implementation gated by architecture probes and the MCP `2026-07-28` final release
- Date: 2026-07-20
- Target: Post-`better-convex-nuxt@0.7` Better Convex monorepo; no 0.7 release requirement
- Scope: Product architecture, protocol boundaries, security invariants, proof plan, Ginko CMS alignment, and release gates
- Decision owner: Better Convex maintainers

## Contents

- [Summary](#summary)
- [Decision requested](#decision-requested)
- [Normative language](#normative-language)
- [Specification checkpoint](#specification-checkpoint)
- [Context and learnings](#context-and-learnings)
- [Goals](#goals)
- [Non-goals](#non-goals)
- [Product principles](#product-principles)
- [Final product architecture](#final-product-architecture)
- [MCP primitive mapping](#mcp-primitive-mapping)
- [Tool model](#tool-model)
- [Authentication and identity provenance](#authentication-and-identity-provenance)
- [MCP protocol location](#mcp-protocol-location)
- [High-blast-radius human interaction](#high-blast-radius-human-interaction)
- [MCP Apps and Vue](#mcp-apps-and-vue)
- [Tasks](#tasks)
- [Vue client runtime](#vue-client-runtime)
- [Nuxt integration](#nuxt-integration)
- [Errors, diagnostics, and observability](#errors-diagnostics-and-observability)
- [Security and threat model](#security-and-threat-model)
- [Ginko CMS alignment](#ginko-cms-alignment)
- [Implementation and proof plan](#implementation-and-proof-plan)
- [Conformance and evidence matrix](#conformance-and-evidence-matrix)
- [Exact-artifact and supply-chain contract](#exact-artifact-and-supply-chain-contract)
- [Compatibility policy](#compatibility-policy)
- [Alternatives considered and rejected](#alternatives-considered-and-rejected)
- [Public API admission test](#public-api-admission-test)
- [Open decisions with closure gates](#open-decisions-with-closure-gates)
- [Documentation plan](#documentation-plan)
- [Acceptance criteria](#acceptance-criteria)
- [Definition of success](#definition-of-success)
- [Change control](#change-control)
- [References](#repository-references)
- [Decision](#decision)

## Summary

Better Convex will become a Vue-first application foundation for Convex with three public integration layers:

```text
Better Convex

Browser applications
  ├── better-convex-vue
  └── better-convex-nuxt

Agent applications
  └── @better-convex/mcp

Canonical backend
  └── application-owned Convex functions and state
```

The governing design is:

> MCP-native at the edge, Convex-native at the core, Vue-first in the UI, and provider-neutral at the authentication boundary.

Better Convex will use the official Model Context Protocol instead of inventing an agent protocol. Ordinary agent writes will be standard, explicit MCP tools backed by ordinary Convex mutations. When the initiating human must complete a high-blast-radius interaction in the application, the integration will use capability-negotiated MCP URL elicitation and same-user binding. Existing application-owned reviewer queues remain ordinary application workflows rather than being disguised as MCP elicitation. Rich in-conversation interfaces will use the official MCP Apps extension. Long-running work may later be projected through the official Tasks extension, but application state remains canonical.

Better Auth remains the first-party authentication and OAuth authorization-server integration. It is not the provider-neutral boundary. Applications may use another conforming authorization server through a narrow verifier contract. Social/OIDC login, OAuth authorization-server operation, and MCP resource-server operation remain separate roles.

The application continues to own:

- tool meaning and business effects;
- roles, memberships, tenants, and permissions;
- current resource authorization;
- scope vocabulary;
- blast-radius policy;
- review wording and impact calculation;
- domain idempotency and external-effect reconciliation;
- canonical workflow and job state.

This RFC deliberately rejects public Commands, Trusted Calls, universal principal, RBAC, and workflow packages. The reusable pieces of those ideas are retained only where the chosen MCP deployment topology or proven application needs require them.

The RFC is complete only when its acceptance evidence is produced. Architectural intent alone is not evidence that the system works.

## Decision requested

Approve the following product direction:

1. Complete and freeze `better-convex-nuxt@0.7` as the secure Nuxt baseline.
2. Rebrand the product family to **Better Convex** and rename the repository only after the second public package is proven, without publishing a catch-all package or relocating the certified Nuxt package merely for symmetry.
3. Add `better-convex-vue` from a private shared client-lifecycle implementation already proven by the Nuxt package.
4. Add `@better-convex/mcp` as an optional standards integration built on the official MCP SDK.
5. Use explicit application MCP tools, not automatic Convex-function exposure.
6. Keep business authorization live and application-owned in Convex.
7. Use ordinary tool calls for ordinary writes.
8. Use MCP URL elicitation plus an authenticated application page when the initiating human must complete a high-blast-radius interaction; preserve application review queues as a distinct composable pattern.
9. Add a Vue integration for the official MCP Apps extension as progressive enhancement.
10. Defer Tasks until the replacement extension and final SDK are stable and interoperable.
11. Resolve the MCP server location through a time-boxed Convex-versus-Nitro proof and retain exactly one protocol implementation.
12. Use Ginko CMS as one proving consumer, while requiring a neutral second consumer before extracting Ginko-motivated behavior into public API.

## Normative language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described by [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when they appear in uppercase.

This RFC separates three kinds of statements:

| Kind            | Meaning                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| Decision        | A product or security boundary that implementation must preserve                |
| Hypothesis      | A preferred implementation that must pass a named proof before adoption         |
| Deferred option | A plausible extension that is intentionally outside the current public contract |

No hypothesis becomes a compatibility promise merely because it appears in this document.

Conformance checklists use these source labels:

| Label           | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `[MCP-2025]`    | Requirement from the current final MCP `2025-11-25` specification                              |
| `[MCP-2026-RC]` | Design target from the locked `2026-07-28` release candidate; not yet a final-compliance claim |
| `[MCP-EXT]`     | Requirement from a separately versioned official MCP extension                                 |
| `[BCN]`         | Stronger Better Convex product or security invariant adopted by this RFC                       |

## Specification checkpoint

At the date of this RFC:

- MCP `2025-11-25` is the latest final base specification.
- MCP `2026-07-28` is a release candidate scheduled to become final on 2026-07-28.
- The release candidate removes the `initialize`/`initialized` handshake and protocol sessions, carries client information and capabilities with requests, adds `server/discover`, and makes the base protocol stateless.
- MCP Apps is an official extension.
- The experimental Tasks model in `2025-11-25` is being replaced by the separately versioned `io.modelcontextprotocol/tasks` extension and is not wire-compatible with that replacement.
- Roots, sampling, and protocol logging are deprecated in the release candidate. Better Convex will not add stable wrappers for them before final-spec reconciliation; applications that require a currently supported form use the official SDK directly and accept its version lifecycle.

The repository baseline when this RFC was created is:

| Item                       | Baseline                                   |
| -------------------------- | ------------------------------------------ |
| Branch                     | `oauth`                                    |
| Commit before this RFC     | `a6e76f1f61a483de5dbd3a19003ab35abcf75fad` |
| Package                    | `better-convex-nuxt@0.7.0-beta.1`          |
| Nuxt                       | `4.4.8`                                    |
| Convex                     | `1.42.2`                                   |
| Better Auth                | `1.7.0-rc.1`                               |
| Better Auth OAuth Provider | `1.7.0-rc.1`                               |
| Kysely                     | `0.28.17`                                  |
| Convex Helpers             | `0.1.114`                                  |

This baseline is historical evidence, not a requirement that vNext retain those versions. The release-compatibility process must choose and certify an explicit tuple for every published candidate.

Authoritative references:

- [MCP `2025-11-25` key changes](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [MCP `2026-07-28` release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP versioning](https://modelcontextprotocol.io/docs/learn/versioning)
- [MCP extensions](https://modelcontextprotocol.io/extensions/overview)

The implementation MUST re-read the final `2026-07-28` specification and changelog after publication. If the final release differs materially from the release candidate, this RFC MUST be amended before a vNext MCP public API is stabilized.

Better Convex MUST NOT expose these as stable application APIs:

- `initialize` lifecycle details;
- `Mcp-Session-Id` ownership;
- raw capability maps;
- raw protocol-version switching;
- legacy `2025-11-25` Tasks types;
- hand-written compatibility shims for protocol versions unsupported by the official SDK.

The official SDK MUST own version and capability mechanics wherever it is runtime-compatible. Better Convex may expose stable semantic operations, such as requesting an external interaction, but MUST NOT expose a wire-version-specific lifecycle as its application contract.

## Context and learnings

The proposed shape is based on the current Better Convex Nuxt implementation, its offensive-security review, packed-consumer certification, and integration feedback from Ginko CMS.

### Current Better Convex Nuxt strengths

The current package already proves several foundations that vNext must preserve:

- one stable browser Convex client handle;
- identity-generation fencing and stale-result retirement;
- SSR request isolation and identity-partitioned payloads;
- shared callable lifecycle for mutations and actions;
- framework-neutral sanitized `ConvexCallError` behavior;
- request-scoped `serverConvex()` callers;
- exact-artifact release fingerprints and packed-consumer checks;
- hardened Better Auth OAuth-provider configuration;
- strict separation of Convex session tokens and OAuth access tokens;
- a fixed MCP resource topology with bounded proxying;
- current-state authorization inside tool-specific Convex functions;
- MCP/OAuth interoperability and selected protocol conformance evidence.

These are assets to extract and reuse. They are not reasons to preserve every current implementation detail.

### Current MCP limitations

The current delegated-human MCP starter is intentionally narrow and contains implementation that must not become the long-term protocol foundation:

- the public Nuxt `/mcp` route is a bounded fixed-target relay;
- the Convex HTTP action is the only bearer verifier;
- the starter manually parses a selected subset of MCP JSON-RPC;
- the release conformance runner currently selects `initialize`, `ping`, and `tools/list` scenarios for `2025-11-25`;
- fixed beta scopes are `mcp:read` and `mcp:write`;
- the starter proves a specific delegated-human OAuth topology rather than a general MCP integration package.

The current relay accepts the version-specific GET, POST, and DELETE transport surface, forwards selected protocol/session headers, caps requests at 64 KiB and ordinary responses at 1 MiB, and uses separate ordinary and SSE timeouts. Those controls are useful evidence, but their exact methods, headers, limits, and streaming assumptions MUST be re-derived from the selected final protocol and SDK rather than copied blindly.

The repository also has a deliberately separate private service-actor starter. It currently runs an MCP toolkit in Nitro and bridges to Convex with an application secret. That private trust model MUST NOT be merged silently with delegated-human OAuth. Public remote MCP follows the standard OAuth resource-server model. A private service path either adopts an applicable official MCP authorization extension or remains an explicitly private deployment with separately documented trust assumptions.

The hand-written protocol implementation is evidence that the topology can be secured. It is not the implementation to extend across new MCP versions, Apps, elicitation, Tasks, and future extensions.

### Ginko CMS learnings

Ginko CMS surfaced concrete needs rather than hypothetical framework flexibility:

1. An embedded Vue/Vite Studio duplicated query subscription, pagination, callable, stale-result, and identity-boundary machinery because the reusable lifecycle existed only inside the Nuxt package.
2. Its MCP integration needed authenticated service-to-Convex calls and built a Ginko-owned signed assertion around an anonymous `serverConvex()` caller.
3. A first mutation failure reached Better Convex as an unstructured `Error`, and the public sanitizer correctly hid the cause. The integration lacked a documented safe diagnostic path and packed query/mutation/action evidence; the 0.7 response was application-owned static telemetry plus exact packed conformance, not a raw-cause hook.
4. Ginko needs application-owned contract compatibility, membership, editorial policy, content scopes, and domain error mapping.
5. Ginko considered a general prepare/confirm/execute protocol because agent hosts do not reliably present exact, application-controlled approval UI.
6. High-impact operations require a reliable authenticated application handoff, while normal writes should remain normal MCP writes.

The correct response is not to move Ginko policy into Better Convex. It is to remove duplicated generic lifecycle, use standard MCP interaction primitives, and preserve Ginko's domain boundaries.

## Goals

1. Provide the best supported Convex experience for Vue 3 and Nuxt applications from one maintained lifecycle implementation.
2. Make explicit application capabilities safely usable from standard MCP hosts.
3. Integrate Better Auth cleanly without making it the only authentication provider.
4. Preserve immediate application authorization and revocation from canonical Convex state.
5. Make routine reads and writes simple MCP tools rather than multi-stage command workflows.
6. Provide a standards-native path for high-impact human review.
7. Provide first-class Vue ergonomics for MCP Apps without exposing browser or server credentials.
8. Keep protocol versioning, capability negotiation, transport, and error semantics aligned with the official MCP specification and SDK.
9. Retain safe error normalization, diagnostics, observability, and exact-artifact release evidence.
10. Let Ginko delete generic integration code while retaining all CMS-specific policy.
11. Permit future framework adapters without designing or publishing a speculative universal core today.
12. Make every stable public abstraction earn its existence through two materially different consumers or one unavoidable standards boundary.

## Non-goals

This RFC does not propose:

- exposing every Convex query, mutation, or action as an MCP tool;
- a generic arbitrary-function MCP gateway;
- a universal principal type that erases credential provenance;
- a Better Convex roles, memberships, capabilities, or policy database;
- roles or current permissions in browser or MCP tokens;
- a public `@better-convex/core` package in the first monorepo release;
- a public Commands or prepare/confirm/execute framework;
- a public Trusted Calls product;
- mandatory preview or confirmation before every write;
- reliance on a ChatGPT, Claude, or other host confirmation dialog;
- a custom MCP transport, task protocol, UI extension, or authentication protocol;
- a stable implementation of the legacy `2025-11-25` Tasks feature;
- a token blacklist as a substitute for live application authorization;
- mandatory database tables for tools, approvals, tasks, diagnostics, or replay protection;
- CMS roles, contracts, editorial workflow, or content policy in Better Convex;
- a Ginko-specific adapter;
- secret-bearing or preauthenticated interaction URLs;
- generic exactly-once external effects;
- per-connection business identity or hidden workflow state;
- keeping old and new client engines active in parallel after migration;
- implementing a Svelte adapter before Vue and Nuxt have proven the extracted boundary.

## Product principles

### MCP is a boundary, not the internal architecture

Better Convex applications remain ordinary Convex applications. MCP describes how an external agent discovers and invokes explicit capabilities; it does not replace the application's function graph, database model, authorization, or UI.

```text
MCP describes how an agent interacts.
Better Convex makes that interaction correct.
Convex applies the canonical effect.
The application decides whether the effect is allowed.
```

### One canonical operation

A business operation MUST have one canonical implementation. Vue, Nuxt, MCP, and MCP Apps may adapt inputs and results, but MUST converge on the same application-owned Convex function or the same domain operation called by that function.

```text
Vue button ───────────────┐
Nuxt server route ───────┼──→ application operation ──→ canonical state
MCP tool ────────────────┤
MCP App tool call ───────┘
```

Transport layers MUST NOT reimplement domain invariants.

### Authentication proves provenance; the application grants authority

Better Convex may verify browser sessions, Convex JWTs, MCP OAuth access tokens, or internal service invocations. Verification proves where a call came from. It MUST NOT silently infer current membership, role, resource ownership, or business permission.

### Progressive capability use

MCP features beyond ordinary tools and resources MUST be capability-negotiated. A server MUST provide a safe baseline result or a clearly unsupported result when a client lacks optional functionality. It MUST NOT branch on ChatGPT-, Claude-, or vendor-specific user agents.

### No security dependency on host UX

Tool descriptions, annotations, host confirmations, MCP App buttons, and model prose improve usability. They do not grant authority and cannot replace backend validation.

### Prefer extraction after proof

Ginko may motivate a primitive, but Ginko alone does not justify a general public abstraction. The primitive remains application-owned until a neutral second consumer demonstrates the same invariant and shape.

## Final product architecture

```text
                                  Better Convex

┌───────────────────────┐  ┌────────────────────────┐  ┌──────────────────────┐
│ Vue/Vite browser      │  │ Nuxt browser + SSR     │  │ MCP host             │
│ better-convex-vue     │  │ better-convex-nuxt     │  │ official MCP client  │
└───────────┬───────────┘  └────────────┬───────────┘  └──────────┬───────────┘
            │                            │                         │
            │ shared client lifecycle    │ SSR/server integration  │ MCP protocol
            │                            │                         │
            └──────────────────┬─────────┴──────────────┬──────────┘
                               │                        │
                               ▼                        ▼
                     explicit application API   @better-convex/mcp
                               │                        │
                               └────────────┬───────────┘
                                            ▼
                                application Convex functions
                                            │
                                live application authorization
                                            │
                                            ▼
                                    canonical Convex state
```

### Public packages

#### `better-convex-vue`

This package owns the plain Vue 3 client experience:

- Vue plugin and injection context;
- stable replacement-safe Convex client handle;
- provider-neutral authentication adapter;
- query, pagination, mutation, and action composables;
- identity-key and identity-generation fencing;
- stale callback and completion retirement;
- cleanup and disposal;
- optimistic update primitives supported by the Convex client;
- embedded-runtime attachment without token exposure;
- optional MCP App Vue integration through a subpath.

It MUST NOT depend on:

- Nuxt;
- Nitro;
- H3;
- Nuxt auto-imports;
- Better Auth as a required dependency;
- the MCP server package for ordinary Vue use;
- server secrets or private signing material.

#### `better-convex-nuxt`

This package owns Nuxt-specific behavior:

- the Vue client experience after hydration;
- Nuxt module installation and auto-imports;
- SSR query execution and payload hydration;
- per-request server isolation;
- request cookie and token handling;
- Better Auth browser and server integration;
- same-origin auth proxying;
- bounded Convex token exchange;
- route middleware;
- `serverConvex()` and safe server diagnostics;
- optional MCP route or fixed façade integration;
- authenticated review-page integration for URL handoffs;
- packed Nitro production evidence.

Nuxt MUST use the same query, pagination, callable, identity, and disposal implementation as Vue after hydration. Once `better-convex-vue` is published, Nuxt consumes that package rather than a copied private implementation. It MUST NOT maintain a second client engine.

#### `@better-convex/mcp`

This optional package owns only MCP-to-application integration:

- official MCP SDK integration;
- safe `McpAccessContext` creation;
- provider-neutral resource-server verifier contract;
- correct OAuth challenge projection;
- explicit Convex tool-handler context;
- structured result and resource helpers where the official SDK needs Convex adaptation;
- URL-interaction adaptation across supported protocol versions;
- safe MCP diagnostics;
- protocol and security conformance helpers;
- a future optional Tasks-extension adapter.

It MUST NOT own:

- application roles or permissions;
- a tool registry separate from the official MCP server;
- automatic Convex API discovery;
- an arbitrary function dispatcher;
- application workflows or approval records;
- canonical task or job state;
- a second OAuth authorization server;
- hand-written MCP wire parsing when the official SDK supports the selected runtime.

Candidate subpaths, subject to the package proof, are:

```text
@better-convex/mcp
@better-convex/mcp/convex
@better-convex/mcp/testing
```

A Better Auth adapter MAY be exposed as an optional subpath only if doing so avoids dependency leakage and is useful outside Nuxt. Otherwise it remains in the Nuxt/Convex integration that already owns Better Auth.

#### Transitional shared client source

Before `better-convex-vue` is approved for publication, the existing repository will contain one private source island for:

- stable client ownership;
- identity transitions;
- query lifecycle;
- pagination lifecycle;
- mutation/action lifecycle;
- error normalization integration;
- disposal.

It MUST NOT become a permanent private workspace package merely to make the directory graph look symmetrical.

The extraction first preserves existing Nuxt behavior and proves the same source through a plain Vite fixture. If Vue publication is approved, that source moves once into `better-convex-vue`; `better-convex-nuxt` then consumes the exact certified Vue package and deletes its old client runtime. The Nuxt package MUST NOT import unpublished Vue source.

During beta, Nuxt SHOULD pin the exact certified `better-convex-vue` version. Its packed manifest MUST contain a registry version, never `workspace:`, `file:`, or `link:`.

### Repository shape

The implemented repository keeps the Nuxt package at the root. A monorepo does not require moving it into a symmetrical directory:

```text
better-convex/
  package.json                     # better-convex-nuxt
  src/                             # existing Nuxt package

  packages/
    vue/
      package.json                 # better-convex-vue
    mcp/
      package.json                 # @better-convex/mcp

  internal/
    labs/
      mcp-topology/                # active neutral final-reconciliation proof

  starters/
    agency/
    public/
    team/
    mcp-oauth-agent/               # delegated-human Convex MCP resource

  docs/
  scripts/
```

This is the hard-cut result of `D-019`, `D-048`, and `P5-021`, not the RFC's
earlier illustrative addition list. The losing Nitro topology, Nuxt MCP relay,
duplicate service-actor starter, and mock-only Agentic SaaS proof are not
parallel compatibility paths. The selected topology supplies one protocol
implementation.

The documentation brand becomes **Better Convex** when the Vue package is approved. The GitHub repository MAY be renamed in the same release window, but the root Nuxt package remains in place. Existing npm consumers keep the `better-convex-nuxt` package name. No `better-convex` meta-package is introduced by this RFC.

## MCP primitive mapping

Applications SHOULD use the narrowest standard primitive that matches the interaction:

| Application need                         | Standard primitive                 | Better Convex responsibility                   | Application responsibility               |
| ---------------------------------------- | ---------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| Read or change state                     | Tool                               | Verified caller context and Convex integration | Schema, meaning, authorization, effect   |
| Stable URI-addressable context           | Resource or resource template      | Convex-aware fetch integration if useful       | URI model and access policy              |
| Large report or artifact                 | Resource link or embedded resource | Safe result construction                       | Artifact retention and authorization     |
| Reusable model-authored workflow         | Prompt                             | No required wrapper                            | Prompt content and trust policy          |
| Missing non-sensitive input              | Form elicitation                   | Capability-aware adaptation                    | Requested fields and validation          |
| Sensitive or high-impact web interaction | URL elicitation                    | Safe protocol projection                       | Page, login, review, and effect          |
| Rich interface inside chat               | MCP Apps                           | Vue lifecycle and server resource integration  | UI and domain behavior                   |
| Long-running operation                   | Tasks extension                    | Optional projection adapter                    | Canonical job and cancellation semantics |
| Current business permission              | Application authorization          | Pass verified provenance                       | Resolve actor and decide access          |

Resource links MUST NOT be treated as approval or navigation consent. Tool annotations MUST NOT be treated as enforcement. Prompts MUST NOT be treated as trusted authorization policy.

## Tool model

### Ordinary operations are ordinary tools

The default MCP write path is one standard `tools/call` backed by one explicit application operation:

```text
MCP tools/call
  → verify the access token for the exact MCP resource
  → validate the exact tool input schema
  → enforce the tool's coarse delegated scope ceiling
  → invoke one explicit application Convex function
  → resolve the current application actor and resource
  → authorize from current canonical state
  → apply the transactional effect
  → return a validated structured result
```

Routine operations MUST NOT be forced through prepare, preview, confirmation-token, or Tasks lifecycles merely because an agent initiated them.

Good tools are narrow and application-named:

```text
search_entries
get_entry
rename_document
create_draft
archive_entry
add_team_member
```

Rejected tool shapes include:

```text
run_convex_function
execute_mutation
admin_action
perform_command
call_internal_api
```

Better Convex MUST NOT derive tool names, descriptions, schemas, scopes, risk annotations, or authorization from Convex function references. The application author explicitly defines each tool and its mapping.

### Official SDK composition

The application-facing API SHOULD compose with the official MCP SDK rather than replace its registration model. The intended shape is conceptually:

```ts
const server = new McpServer(serverInfo)

server.registerTool(
  'rename_document',
  officialToolDefinition,
  withBetterConvex(async ({ convex, access }, input) => {
    requireMcpScope(access, 'documents:write')

    return await convex.mutation(api.documents.rename, input)
  }),
)
```

The names in this example are not approved public API. The proof must determine the smallest adapter needed by the selected official SDK and runtime. The stable idea is a safe handler context, not a second tool framework.

### Tool schemas

Every published tool MUST:

1. define a precise input schema;
2. define and validate an output schema where the supported MCP version permits it;
3. reject unknown properties where forward compatibility does not require them;
4. validate again at the Convex function boundary;
5. return `structuredContent` for model-readable data;
6. return a concise text representation for compatible fallback behavior;
7. bound strings, arrays, result counts, and resource sizes;
8. avoid unnecessary PII and secrets;
9. document whether external systems may be affected;
10. avoid accepting a caller-supplied user, tenant, role, or permission as authority.

Schema validation at the MCP edge protects the protocol and user experience. Convex validation protects the canonical operation. Neither validation replaces authorization.

### Tool annotations

Applications SHOULD provide accurate standard annotations:

```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}
```

The annotations are untrusted hints. No backend decision may depend on a client interpreting them.

In particular:

- `destructiveHint: false` means the operation is additive-only; it does not mean merely low risk.
- `idempotentHint: true` is allowed only when repeating the same call produces no additional effect, including audit or external side effects relevant to the application contract.
- `openWorldHint: true` describes interaction with external entities; it does not merely mean that the implementation uses a network.
- JSON-RPC request IDs, MCP session IDs, MCP task IDs, and local call IDs are not automatically application idempotency keys.

Better Convex MAY provide development-time consistency checks, but MUST NOT infer annotations from function kind or naming.

Reference: [MCP tools and annotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

### Tool errors and results

The MCP integration MUST distinguish:

| Failure                                                       | Representation                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| Malformed JSON-RPC, unknown method, or unknown tool           | JSON-RPC protocol error                                    |
| Tool input rejected in a correctable way                      | Tool execution error                                       |
| Expected domain outcome                                       | Typed structured result when the model can act on it       |
| Missing or invalid MCP authentication                         | HTTP/OAuth resource challenge                              |
| Insufficient delegated scope                                  | `403` with `insufficient_scope` challenge where applicable |
| Downstream application or API failure the model can act on    | Sanitized tool execution error                             |
| MCP server, transport implementation, or infrastructure fault | Sanitized JSON-RPC server/internal error                   |

Expected application outcomes SHOULD be values when that improves truthful handling:

```ts
type RenameDocumentResult =
  | { status: 'applied'; documentId: string }
  | { status: 'already_applied'; documentId: string }
  | { status: 'not_found' }
  | { status: 'blocked'; code: string }
```

Cross-tenant unauthorized and nonexistent resources SHOULD remain indistinguishable when revealing existence would leak information.

Raw errors, stacks, response bodies, arguments, bearer tokens, cookies, sessions, provider authorization references, internal proofs, and database records MUST NOT appear in MCP results.

### Rate limits and abuse controls

The MCP resource MUST support bounded request bodies, bounded responses, timeouts, and rate limits. Rate-limit keys SHOULD be derived from the verified resource, subject, client, tool, and trusted network context appropriate to the deployment. They MUST NOT rely only on attacker-controlled headers.

The application MAY add operation-specific limits inside Convex. Expensive or high-impact tools SHOULD have stricter limits than discovery and ordinary reads.

Invalid bearer credentials MUST return an authentication failure. They MUST NOT be downgraded to anonymous access. Any protocol session or application handle is routing or workflow state, not authentication; credentials MUST be verified on every protected HTTP request.

## Authentication and identity provenance

### Four distinct contexts

Better Convex MUST preserve credential provenance instead of collapsing every caller into one public principal union.

```ts
type McpAccessContext = {
  issuer: string
  subject: string
  clientId: string
  resource: string
  scopes: ReadonlySet<string>
}

type WebSessionContext = {
  provider: string
  userId: string
  sessionId: string
}

type NitroMcpInvocationContext = {
  issuer: string
  serviceId: string
  callId: string
  delegatedMcpAccess: McpAccessContext
}

type ConvexBrowserIdentity = {
  subject: string
  audience: 'convex'
  tokenUse: 'convex-session'
}
```

These are explanatory shapes, not approved public types. `NitroMcpInvocationContext` exists only if the Nitro topology wins and always represents a delegated MCP call; a non-MCP service-call API requires a later RFC. The implementation may use branded internal types or narrower structures.

The application maps a verified context to its own actor:

```text
verified MCP (issuer, subject, client)
  → application-owned identity mapping
  → current credential/member/tenant lookup
  → current application actor
  → operation-specific authorization
```

Better Convex MUST NOT silently assert that:

- an OAuth subject is an application member;
- a service is a human user;
- an MCP scope is a role;
- a valid internal signature grants business authority;
- a Better Auth session cookie is an MCP credential;
- a Convex browser JWT is an MCP token;
- two identities with the same email are the same security principal.

External subject identity MUST use the collision-safe `(issuer, subject)` tuple. Applications MAY create an explicit mapping to their canonical user or service actor. Email addresses MUST NOT be the security join key.

An internal verifier may also preserve an opaque provider-owned session, grant, or credential reference for live provider checks. That reference is private server metadata, not part of the application-facing `McpAccessContext`. Better Convex and applications MUST NOT infer its meaning from its syntax. The Better Auth adapter MUST preserve the provider session or equivalent reference required for current session/client/consent checks. An external verifier without live provider state uses no reference; that profile cannot promise immediate authorization-server session or consent revocation beyond token validation, but application membership and credential revocation remain live.

Provider authorization references MUST remain behind the verifier and the internal Convex bridge. They MUST NOT appear in tool results, resource contents, URLs, logs, diagnostics, serialized errors, Vue state, MCP App messages, or application-facing access-context objects.

If a protected function sees incompatible browser and service identities, it MUST deny the call unless that exact function explicitly defines how the contexts compose. It MUST NOT choose one implicitly.

### Better Auth roles

Better Auth is the default first-party integration, but its roles remain separate:

```text
Host-selected social/OIDC login
  authenticates a browser user to the application

OAuth authorization-server operation
  issues delegated tokens to registered clients

MCP resource-server operation
  accepts tokens for the exact MCP resource
```

Enabling Google, GitHub, or another social provider MUST NOT automatically enable either OAuth authorization-server or MCP resource-server operation.

The Better Auth OAuth Provider is suitable as the default adapter because it supports OAuth 2.1 behavior, PKCE, issuer validation, resource audiences, consent, token verification, revocation, and MCP resource-server integration. It remains an optional implementation behind the provider-neutral MCP verifier boundary.

The current pinned OAuth Provider treats its client/resource privilege callbacks as optional, while Better Convex makes them mandatory and fail-closed. That construction-time invariant remains release-gating. Every Better Auth or OAuth Provider upgrade MUST re-read the exact installed endpoint and callback behavior, verify option names and installation identity, and rerun ordinary-user-to-OAuth-administrator negative tests.

References:

- [Better Auth social OAuth](https://better-auth.com/docs/concepts/oauth)
- [Better Auth OAuth 2.1 Provider](https://better-auth.com/docs/plugins/oauth-provider)

### MCP OAuth resource-server profile

Protected remote HTTP MCP deployments MUST implement the applicable final MCP authorization specification. At minimum, the supported profile MUST cover:

- OAuth 2.0 Protected Resource Metadata under RFC 9728;
- authorization-server metadata and/or OpenID Connect discovery as required by the negotiated MCP version;
- the exact `resource` indicator in authorization and token requests;
- exact token audience validation for the logical MCP resource;
- exact issuer validation;
- Authorization Code flow with PKCE S256 for delegated public clients;
- exact redirect URI validation;
- bearer-token authentication on every protected MCP HTTP request;
- `401 Unauthorized` for missing or invalid credentials;
- `403 Forbidden` plus `insufficient_scope` challenges where a valid token lacks a required delegated scope;
- short-lived access tokens;
- access-token, ID-token, and Convex-session-token class separation;
- least-privilege scope selection and incremental scope challenges where supported;
- a documented client-registration strategy.

Reference: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

Dynamic Client Registration is optional under the current specification. Better Convex MUST NOT enable unauthenticated registration merely to make a client connect. Preregistered clients or OAuth Client ID Metadata Documents are valid strategies when interoperable with the selected authorization server and clients.

The current fixed `mcp:read` and `mcp:write` scopes remain a beta profile for the 0.7 starter. The final MCP package MUST allow applications to define a bounded scope vocabulary and per-tool requirements without turning scopes into an authorization DSL.

Refresh tokens are not required for MCP compliance. Better Convex SHOULD retain the no-refresh profile until rotation, reuse handling, revocation, secure storage, public-client behavior, and packed interoperability are proven for the selected Better Auth version. Enabling refresh tokens later MUST be an explicit profile change.

For machine-to-machine clients, Better Convex SHOULD evaluate the official [OAuth Client Credentials extension](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials) after client demand and interoperability justify it. It MUST NOT invent an MCP-specific shared-secret authentication protocol for public remote MCP.

### Token separation and passthrough

```text
MCP OAuth token
  proves client → logical MCP resource

Convex browser JWT
  proves browser session → Convex

Internal service proof, if needed
  proves selected MCP server → exact Convex invocation

Application database state
  decides current business authority
```

An MCP access token MUST NOT be:

- accepted as a Convex session token;
- accepted as a Better Auth browser session;
- forwarded to a different resource or third-party API;
- stored in application tables for later replay;
- embedded in a URL;
- returned to an MCP App;
- logged or included in diagnostics.

Token passthrough is explicitly forbidden by the MCP security guidance. If a Nitro MCP server terminates the access token, the downstream Convex hop MUST use a separate internal credential. If a Convex HTTP action is part of the logical MCP resource implementation, the bearer may reach that fixed action but MUST terminate there and MUST NOT be passed into general Convex functions.

Reference: [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices).

### Live application authorization

Token scopes and consent are delegation ceilings. Every protected operation MUST re-read the current authoritative state needed for the effect, including the applicable:

- user or service actor;
- session or credential status;
- OAuth session, client, and consent when the certified provider adapter exposes live grant state;
- organization and membership;
- role or application permission;
- resource ownership and tenant boundary;
- delegation;
- operation-specific precondition;
- application rate limit;
- high-impact review state, if required.

For a Convex mutation, application authorization and the state effect SHOULD occur in the same transaction. A removed member, revoked application credential, reduced application delegation, expired application grant, or downgraded role MUST fail the next protected operation even if an access token remains cryptographically valid.

Authorization-server session, client, or consent revocation MUST fail the next applicable operation only for a certified adapter that performs the required live provider-state check. A signature-only or otherwise offline external verifier MUST document that those authorization-server changes remain bounded by access-token expiry or the provider's own revocation mechanism. The release evidence MUST identify which profile was tested; it MUST NOT claim next-call OAuth grant revocation from self-contained-token validation alone.

Roles and permissions MUST NOT be trusted from long-lived token claims as current authority.

## MCP protocol location

### Decision rule

Better Convex will ship one canonical MCP protocol implementation. The physical location is a hypothesis to be settled by a proof after the final `2026-07-28` specification and compatible official SDK are available.

The two candidates are:

```text
Candidate A: Convex-native

MCP client
  → logical /mcp resource
  → official MCP SDK in Convex HTTP action
  → explicit internal Convex function
  → current application authorization
```

```text
Candidate B: Nitro-native

MCP client
  → logical /mcp resource
  → official MCP SDK in Nitro
  → separate exact-call service proof
  → explicit Convex function
  → current application authorization
```

Candidate A is preferred because it is framework-neutral, keeps protocol and canonical state close, supports Nuxt and plain Vue applications, and avoids a second internal authentication mechanism. It becomes canonical only if it passes every hard gate.

Candidate B is the fallback if the official SDK, transport, or required protocol features cannot run correctly within the Convex HTTP runtime.

Candidate A's “logical MCP resource” is an objective security boundary, not a label chosen after implementation. The proof MUST select and demonstrate one of these arrangements:

1. the public Convex endpoint is the canonical MCP resource and performs access-token verification; or
2. a public relay is only transparent ingress for that same resource: one canonical resource URI and audience, one fixed TLS origin and path, no redirects, no independent token consumer, no credential logging, exact header/path normalization, and no other Convex function that can receive the bearer.

Protected Resource Metadata, authentication challenges, and audience validation are tested at the public URI. Executed tracing MUST prove that a bearer can reach only the one canonical verifier. A relay that terminates authority and then forwards the token to a separately identified resource is not Candidate A; it is token passthrough and fails the gate.

The proof MUST NOT result in both candidates being supported as peer implementations. Once selected:

- the losing protocol stack is deleted or retained only as clearly isolated historical test evidence;
- starters use the selected stack;
- conformance runs against the selected stack;
- documentation names one supported topology;
- no runtime-detection branch chooses between them.

### Convex-native hard gates

The official MCP SDK in a Convex HTTP action MUST prove:

1. final `2026-07-28` request and discovery behavior;
2. correct use of standard `Request` and `Response` APIs without unsupported Node dependencies;
3. `tools/list` and `tools/call` with exact schemas and structured results;
4. resources and resource templates needed by the neutral fixture;
5. URL elicitation or its final stateless interaction equivalent;
6. MCP Apps UI-resource serving;
7. official extension capability handling;
8. correct protocol and HTTP errors;
9. cancellation and abort behavior supported by the final SDK/runtime contract;
10. bounded request and response handling;
11. access-token verification for the exact logical resource;
12. no bearer propagation into general Convex functions;
13. production deployment without undocumented bundler patches;
14. official conformance evidence and real-client interoperability;
15. acceptable latency, timeout, and operational behavior.

Any required fork of the official SDK, hand-written replacement transport, unsupported runtime polyfill, or protocol feature omission is a failed gate unless the relevant feature is explicitly optional and a standards-compliant fallback exists.

### Nitro-native hard gates

If Candidate A fails, the Nitro implementation MUST prove:

1. the same protocol, OAuth, feature, and client conformance;
2. one request-scoped MCP server context without cross-request identity state;
3. access-token termination at Nitro;
4. a separate exact-call proof for the Convex hop;
5. exact operation, function, and argument binding;
6. no generic signed function dispatcher;
7. application authorization inside Convex;
8. safe replay and idempotency behavior for each write category;
9. key rotation and deployment-audience separation;
10. packed production Nitro evidence.

### Internal exact-call proof

This section applies only if the Nitro-native topology wins. It does not create a public Trusted Calls product.

The internal proof MUST use a strict versioned allowlist with fields equivalent to:

```ts
type ServiceCallProofV1 = {
  version: 1
  issuer: string
  audience: string
  keyId: string
  serviceId: string
  callId: string
  issuedAt: number
  expiresAt: number
  operation: 'query' | 'mutation' | 'action'
  functionName: string
  argsDigest: string
  mcp: {
    issuer: string
    subject: string
    clientId: string
    resource: string
    scopes: string[]
    authorizationReference: {
      kind: string
      id: string
    } | null
  }
}
```

Required invariants:

- a dedicated key distinct from Better Auth secrets, OAuth signing keys, Convex session keys, and deployment credentials;
- an asymmetric algorithm supported by both runtimes where practical;
- a separately keyed, explicitly lower-assurance HMAC fallback only if the runtime proof rejects asymmetric verification;
- strict algorithm, issuer, audience, key ID, time, version, and unknown-field validation;
- a short maximum lifetime with no ambient renewal;
- canonical Convex-value encoding and a cryptographic digest over application arguments;
- operation kind and official function name binding;
- exclusion of the proof envelope from the argument digest;
- no raw argument or proof logging;
- explicit wrapped functions rather than a general dispatcher;
- application actor resolution and authorization after proof verification.

The canonical argument encoder MUST be specified and tested for every supported Convex value type, recursively sorted object keys, equivalent encodings, unsupported values, and mutation after signing.

`mcp.authorizationReference` is private bridge metadata governed by the privacy boundary in [Four distinct contexts](#four-distinct-contexts). It is never exposed to application callers or observability sinks.

The service proof authenticates one internal invocation. It does not guarantee generic exactly-once execution. Non-idempotent operations MUST use an application idempotency key or transactional replay policy where repeated execution would violate the domain contract. External APIs require their own idempotency and reconciliation. Every mutation or action wrapper MUST name that invariant explicitly; wrappers without one are not eligible for the Nitro topology.

## Ordinary write example

Deleting a low-impact draft that is already recoverable may remain an ordinary tool:

```text
tools/call archive_draft({ draftId })
  → MCP token valid for exact resource
  → documents:write scope present
  → current actor maps to active organization member
  → draft belongs to the organization
  → current member may archive drafts
  → one mutation marks the draft archived
  → result is applied or already_applied
```

The application MAY decide that its archive operation is high impact and require external review. That is an application policy choice, not a semantic inference made from the word `archive` or from `destructiveHint`.

## High-blast-radius human interaction

### When to leave the agent host

Applications SHOULD reserve authenticated external review for operations whose blast radius, sensitivity, reversibility, regulatory consequence, or need for step-up authentication justifies the interruption.

Examples may include:

- deleting a user, organization, environment, or collection;
- bulk destructive changes;
- production credential rotation;
- payments or billing changes;
- irreversible publication or purge;
- external side effects with significant cost;
- operations requiring exact current-impact review;
- operations requiring application-specific second-person approval.

Routine writes SHOULD remain ordinary tools. Better Convex MUST NOT require every MCP write to create a pending record or leave the conversation.

### Direct same-user external interaction

The current final MCP specification provides URL-mode elicitation for interactions that the initiating user must complete outside the client. It is the standards-native mechanism for directing that same human to an authenticated application page.

```text
MCP tool call
  → application classifies the requested operation as requiring review
  → application creates a bounded pending interaction
  → MCP server requests URL elicitation, or returns the final-version equivalent
  → host presents the domain and asks the human whether to open it
  → human opens the authoritative application
  → Better Auth or the selected web identity provider authenticates the browser
  → application verifies the initiating identity relationship
  → page displays current consequences
  → initiating human submits the meaningful application action
  → one Convex mutation reauthorizes, consumes, and applies the local effect
  → MCP client receives completion or a safe status/receipt
```

Under `2025-11-25`, the server may issue `elicitation/create` in URL mode or return `URL_ELICITATION_REQUIRED` (`-32042`) where appropriate. The `2026-07-28` final interaction model MUST be implemented through its official SDK shape rather than frozen from the release candidate.

The response `action: "accept"` means only that the user accepted navigation. It does not mean the web interaction or business operation completed. Opening a page is not enough to mark an application interaction complete.

Reference: [MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).

### Pending interaction ownership

The pending record is application-owned until two independent applications prove a common storage contract. Better Convex initially provides protocol projection and conformance helpers, not a mandatory table or workflow component.

The application record SHOULD bind at least:

```text
MCP issuer
MCP subject
MCP client ID
MCP resource
operation identifier
canonical argument digest or immutable target reference
created time
expiry
status
application-specific requester identity
```

It MAY also record an application idempotency key, current impact version, or workflow reference when those are required by the domain. An existing application review record may derive some binding fields immutably from a canonical requester, integration, or agent-run record rather than duplicate them, but that derivation and its retention must be explicit.

The record MUST NOT store the bearer token or internal service proof.

### URL requirements

The elicitation URL MUST:

- use HTTPS outside exact loopback development;
- use one configured authoritative application origin;
- contain only a high-entropy opaque locator;
- contain no PII, bearer token, Better Auth session, Convex JWT, internal proof, raw arguments, role, or approval capability;
- be bounded in length;
- expire;
- remain safe if copied, prefetched contrary to the specification, crawled, or opened by a link scanner.

The URL is a locator, not authorization.

The server MUST NOT accept a caller-provided origin or redirect destination for the review URL.

### Direct-interaction page requirements

The page completing a same-user MCP elicitation MUST:

1. perform no mutation on `GET`;
2. require an authenticated web session;
3. verify the expected relationship between the web user and the initiating `(issuer, subject)`;
4. show an account-mismatch state rather than silently rebinding another user;
5. load the target and current consequences from canonical state;
6. show the exact application and domain;
7. show expiry and whether the operation changed;
8. use a state-changing POST or Convex mutation for confirmation;
9. preserve the application's CSRF and origin protections;
10. set `Cache-Control: private, no-store`;
11. deny framing with `frame-ancestors 'none'` or an equivalent policy unless an explicitly reviewed product requirement overrides it;
12. use a referrer policy that does not leak the opaque locator;
13. reauthorize and recompute impact at commit time;
14. reject material drift as stale;
15. consume the interaction and apply local state effects transactionally;
16. make retries and concurrent confirmation safe;
17. return a durable application receipt or safe terminal status.

Opening the page MUST NOT execute the operation. A materially changed effect MUST NOT be executed from the old review. The human must receive a new review of the changed effect.

### Application review queues are separate

MCP's URL-elicitation phishing guidance requires the server and application to prevent an initiating user from forwarding a link that causes another user to unknowingly complete the initiator's elicitation. A URL-elicitation completion therefore MUST preserve and verify the initiating identity relationship.

An application-owned reviewer queue is a different workflow:

```text
MCP tool
  → creates the application's canonical pending review as its ordinary effect
  → returns a structured receipt and an inert application locator

current authorized reviewer
  → enters the application's canonical review queue
  → evaluates current authority and impact
  → approves or rejects under application policy
```

A reviewer may be the requester or a different person according to application policy. A different reviewer MUST NOT be described as completing the requester's URL elicitation, and forwarding an elicitation URL MUST NOT transfer requester identity or authority. If the application uses URL elicitation in addition to its queue, it is allowed only for a meaningful action by the initiating user and retains the same-user rules above. Reviewers otherwise enter the normal authenticated application queue under their own identity.

The queue locator is not an approval capability. `GET` performs no mutation, the application authenticates the reviewer, current reviewer authorization and impact are checked at commit, and the canonical review record owns status and receipts. Better Convex supplies transport projection, not reviewer policy and not a second queue.

### Completion and retry

Completion notification is optional under `2025-11-25`. Clients may fail to receive it. The design MUST work with explicit retry or status polling.

If the application page already applied the operation, a retry carrying the explicit application interaction or operation key MUST return the stored receipt or terminal status. It MUST NOT apply the operation again. The key may travel through the final MCP multi-round-trip state, an explicit tool argument, or a separate status tool, but its ownership must be specified and authenticated.

The server MUST NOT infer a retry by matching subject plus tool arguments. A later intentional call with equal arguments is a new application request unless it carries the prior operation key. JSON-RPC IDs, MCP session IDs, and argument digests do not supply this idempotency contract.

For clients without URL-elicitation support, a direct same-user interaction MUST NOT bypass capability negotiation by returning a clickable URL. It returns a clear structured unsupported outcome and creates no effect that depends on the missing interaction:

```ts
type InteractionUnsupported = {
  status: 'interaction_unsupported'
  retryable: false
  message: string
}
```

An application review queue is different: the ordinary tool may return its inert authenticated queue locator because queue creation is already the tool's canonical effect and the locator grants no identity or approval. That result MUST NOT be described as a fallback implementation of URL elicitation.

### External effects

Convex mutations can atomically update Convex state but cannot make an external API call transactional. For payment, email, third-party deletion, deployment, or other external effects, the application SHOULD use:

```text
confirmation mutation
  → reauthorize
  → consume interaction
  → record approved intent and external idempotency key
  → atomically schedule application work

action or worker
  → invoke external provider with its idempotency key
  → record outcome through a mutation
  → reconcile unknown outcomes
```

Better Convex MUST NOT market this as exactly-once external execution. Cancellation cannot undo a committed external effect.

References:

- [Convex mutations](https://docs.convex.dev/functions/mutation-functions)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)

## MCP Apps and Vue

### Purpose

MCP Apps is the primary standards-aligned opportunity for Better Convex to bring Vue interfaces into agent hosts. It allows MCP tools to declare `ui://` resources that supporting hosts render in sandboxed iframes and connect through the official App Bridge.

Reference: [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview).

Appropriate uses include:

- dashboards and visualizations;
- content or document previews;
- search result exploration;
- configuration forms;
- rich media viewers;
- multi-step low- or medium-risk interactions;
- progress and operational status;
- displaying the consequences of a high-impact operation before sending the user to the authoritative application.

MCP Apps is progressive enhancement. Every model-visible tool that launches or accompanies an App MUST remain useful through structured and text results when the host lacks the extension. App-only tools need not pretend to be model-facing fallbacks, but they remain capability-gated, schema-validated, and authorized like every other tool.

### Vue integration

The proposed public entry point is:

```text
better-convex-vue/mcp-app
```

It SHOULD compose with `@modelcontextprotocol/ext-apps` and provide Vue lifecycle integration for:

- App Bridge initialization;
- host capability and context state;
- host theme and display state;
- current tool input;
- current tool result;
- tool-result updates;
- calling allowed MCP tools through the host;
- opening allowed external links through the host;
- cleanup on Vue scope disposal;
- safe error normalization;
- test harnesses for the iframe boundary.

An illustrative consumer shape is:

```ts
const app = useMcpApp()
const input = useMcpToolInput()
const result = useMcpToolResult()
const host = useMcpHostContext()

await app.callTool('filter_entries', {
  collection: input.value.collection,
  filters: selectedFilters.value,
})
```

These names are not approved until tested against the final extension SDK. The package SHOULD follow official terminology rather than rename App Bridge concepts.

### MCP App security boundary

The iframe MUST NOT receive:

- a Better Auth cookie or session value;
- a Convex browser JWT;
- an MCP OAuth bearer token;
- a refresh token;
- an internal service proof;
- a provider authorization reference;
- a server signing key;
- an unrestricted raw Convex client;
- private host state outside the official App Bridge contract.

The app calls MCP tools through the host. The server re-verifies the MCP request and performs live application authorization.

The server and app MUST declare restrictive CSP and only necessary permissions. Tool results sent to the iframe MUST be minimized and treated as potentially user-visible. The implementation MUST test unsupported host capabilities, denied link opening, denied tool calls, unmount, reconnect, repeated results, and malicious result content.

App-only tool visibility is presentation metadata, not authorization. An app-only tool MUST enforce the same verified caller, delegated scope, application permission, rate limit, and audit rules as a model-visible tool.

Dynamic application data MUST arrive as validated tool/resource results or other official App Bridge messages. It MUST NOT be interpolated unsafely into executable UI-template HTML. External navigation MUST use the host-controlled link capability when the extension requires it.

An MCP App button is not additional authority. A high-blast-radius operation that requires application login, step-up authentication, or exact current review SHOULD use URL elicitation to the authoritative application.

### No direct Convex attachment by default

An MCP App is not the same integration mode as an embedded Ginko Studio. The default MCP App runtime MUST communicate through App Bridge rather than attach to the host application's Convex browser client.

If a future authenticated direct-Convex MCP App profile is proposed, it requires a separate RFC covering iframe origin, token acquisition, audience, CSP, third-party cookie behavior, identity transitions, and host isolation.

An MCP App's `ui/open-link` request is navigation, not URL-elicitation consent. It MAY open a normal authenticated application queue locator. If it opens an opaque pending-interaction URL governed by URL elicitation, every same-user and handoff invariant still applies, and the initiating tool MUST use the negotiated URL-elicitation mechanism when the protocol requires it. An App Bridge message never creates reviewer authority.

## Tasks

### Current decision

Better Convex MUST NOT implement the legacy experimental Tasks API from MCP `2025-11-25` as a stable feature.

The replacement Tasks extension:

- uses extension identifier `io.modelcontextprotocol/tasks`;
- is not wire-compatible with the legacy Tasks model;
- uses task creation from a tool result;
- defines `tasks/get`, `tasks/update`, and `tasks/cancel`;
- removes `tasks/list` and `tasks/result` from the replacement model;
- requires authentication and authorization on every task request;
- is intended to evolve independently before possible future core inclusion.

References:

- [Tasks extension overview](https://modelcontextprotocol.io/extensions/tasks/overview)
- [SEP-2663: Tasks Extension](https://modelcontextprotocol.io/seps/2663-tasks-extension)

### Future adapter boundary

After the final base protocol and official SDK support are stable, Better Convex MAY provide an optional adapter that projects an application-owned job or handoff as an MCP Task.

```text
application job or handoff record
  ├── structured status result for baseline clients
  └── MCP Task projection when the extension is negotiated
```

The adapter MUST NOT own a second workflow database. It MUST map the application's canonical status and cancellation behavior.

Every task request MUST:

- authenticate the current MCP access context;
- verify access to the specific task;
- bind the task to the appropriate subject, client, resource, and application actor;
- use opaque unguessable task IDs;
- bound status messages and exclude raw errors or sensitive data;
- define a bounded retention period;
- rate-limit polling and updates;
- treat cancellation as cooperative rather than rollback;
- preserve a terminal application receipt after the underlying effect commits.

Task creation MUST be server-directed after extension negotiation. A returned task handle MUST refer to durable state that an immediate authorized `tasks/get` can read. The implementation MUST follow the final extension's distinction between a completed tool result carrying `isError` and a protocol-level failed task; it MUST NOT map every application rejection to infrastructure failure. A downstream application failure that produced a valid actionable tool result may complete with `isError`; an MCP server or task infrastructure failure uses the extension's failed-task semantics.

Any Task `inputRequests` receive the same trust treatment as standalone elicitation. The adapter MUST negotiate form or URL capability before projecting the request, prohibit sensitive data in form elicitation, apply same-user binding to URL interactions, validate returned form data against the exact schema, and deduplicate repeated input requests observed across polling or notifications. Re-observing the same input request MUST NOT repeat an application effect.

The replacement path MUST NOT expose `tasks/list` or `tasks/result` unless a separately certified legacy protocol path is owned entirely by the official SDK.

Tasks are appropriate for reports, imports, indexing, batch jobs, and long-running human interaction. They are not required for ordinary mutations and do not block Better Convex 1.0.

## Vue client runtime

### Stable client ownership

The shared client source MUST preserve the existing stable-handle model. Consumers receive a stable handle for:

```text
query
mutation
action
onUpdate
```

Authentication may replace the underlying Convex client, but the public handle remains stable. Lifecycle methods that could close, replace, or reauthenticate the underlying client MUST NOT be exposed through the ordinary consumer handle.

### Identity model

The runtime MUST maintain both:

```text
identityKey
identityGeneration
```

`identityKey` partitions data between stable identities such as anonymous, Alice, and Bob. `identityGeneration` retires work when a session is revoked or replaced even if the same stable user signs in again.

```text
Alice generation 7 starts a request
Alice session is revoked
Alice generation 8 signs in
generation 7 result arrives
result is discarded
```

At an identity boundary, protected data MUST be cleared synchronously unless the data is explicitly public and identity-independent. Better Convex does not discover application permission changes by itself. When an application-provided execution or capability gate becomes false, the controller MUST unsubscribe, retire pending work, and clear protected data according to the documented gate policy.

### Provider-neutral browser auth adapter

The Vue package SHOULD use a narrow adapter equivalent to:

```ts
interface BetterConvexVueAuthAdapter {
  readonly state: Readonly<
    Ref<{
      status: 'loading' | 'authenticated' | 'anonymous' | 'error'
      identityKey: string
      error: Error | null
    }>
  >

  getToken(): Promise<string | null>
  subscribe(listener: () => void): () => void
}
```

This is an illustrative contract, not a frozen declaration. The proof must establish the minimum surface needed by Better Auth, another provider or custom callback, anonymous-only applications, and embedded mode.

The adapter returns a short-lived Convex credential when required. It MUST NOT expose server secrets, deployment keys, refresh tokens, or Better Auth signing material.

### Query controller

One shared controller MUST own:

- one live subscription per composable instance;
- reactive argument changes;
- one canonical skip or enabled policy;
- stale callback rejection;
- identity-generation retirement;
- previous-data behavior;
- transform behavior;
- normalized error state;
- Vue scope disposal.

The public API SHOULD choose one canonical execution gate. It SHOULD NOT preserve overlapping `enabled`, `skip`, and sentinel systems merely for speculative flexibility.

### Pagination controller

One shared controller MUST own:

- the first-page subscription;
- later-page acquisition;
- cursor chains;
- one-load-at-a-time semantics;
- pagination generation;
- stale page rejection;
- identity retirement;
- first-page boundary changes;
- subscribed-page or tail reconciliation;
- empty pages with continuation cursors;
- reset and refresh;
- disposal;
- optional application-selected first-page metadata.

Generic metadata MAY be exposed as `pageData` or another neutral name. Better Convex MUST NOT add CMS-specific `facets`. Automatic merging of arbitrary metadata across pages is rejected unless the application supplies an explicit merge function.

### Callable controller

Mutation and action composables SHOULD share one callable lifecycle that owns:

- authentication settlement;
- current identity generation;
- pending state;
- stale completion retirement;
- generic error normalization;
- callback containment;
- reset;
- optional supported optimistic update integration.

The caller's identity generation MUST be captured before waiting for authentication settlement. If the generation changes, the awaited call rejects with the safe identity-changed outcome; suppressing a reactive update while still resolving the original Promise is insufficient because post-`await` application code would continue under the replacement identity. `reset()`, cancellation, and Vue-scope disposal MUST increment or otherwise retire the active operation revision so a late completion cannot repopulate state. A success or error callback that throws MUST NOT turn a remotely committed success into an apparent call failure or replace the original normalized error.

Applications MAY add preflight and error mapping, for example Ginko contract compatibility. The runtime MUST NOT treat a frontend preflight as backend authorization.

### Embedded mode

Embedded Vue applications, such as Ginko Studio, MUST attach through an opaque stable runtime handle and observable identity state. The inter-bundle boundary SHOULD be framework-neutral so a host and embedded application with separate Vue copies do not rely on cross-runtime `Ref` identity or polling:

```ts
interface BetterConvexAttachedRuntime {
  client: StableConvexClientHandle
  identity: {
    snapshot(): {
      status: 'loading' | 'authenticated' | 'anonymous' | 'error'
      key: string
      generation: number
      error: ConvexCallError | null
    }
    subscribe(listener: () => void): () => void
    waitForSettlement(): Promise<void>
  }
}
```

This shape is illustrative and must earn its exact public surface through the embedded fixture. `better-convex-vue` converts it to local Vue refs inside the consuming application.

They MUST NOT receive:

- raw session cookies;
- Better Auth secrets;
- refresh tokens;
- server signing keys;
- an internal token-exchange implementation;
- a raw client reference that becomes stale after identity replacement.

The host and embedded application MUST share the same identity generation and disposal semantics.

Reference: [Vue composables](https://vuejs.org/guide/reusability/composables.html).

## Nuxt integration

Nuxt keeps responsibilities that cannot be hidden inside a plain Vue composable:

- request cookies;
- per-request server auth state;
- SSR data fetching;
- payload serialization;
- identity-partitioned hydration;
- server token exchange;
- route middleware;
- Nitro server calls;
- runtime configuration;
- auth and MCP route registration;
- response cache and security headers.

Nuxt MAY retain an asynchronous SSR-facing query creation API where required. After hydration, live execution MUST use the shared client controller.

The Nuxt and Vue result shapes SHOULD align where semantics match, but they MUST NOT fake identical construction behavior when SSR genuinely requires awaiting server data.

Per-request authenticated callers MUST never be placed in module-global state. SSR data and authentication MUST retain the current request-isolation, `private, no-store`, and identity-partitioning guarantees.

## Errors, diagnostics, and observability

### Error ownership

The existing three-layer model remains:

```text
MCP or transport boundary
  → protocol/authentication representation

Better Convex operation boundary
  → sanitized ConvexCallError

Application domain
  → typed result or structured Convex application error
```

Better Convex MUST NOT inspect English error messages to infer client, transport, authentication, or domain categories.

Recognized structured Convex application error data may remain available through the existing safe path. Unknown plain errors remain publicly opaque.

### Existing server-call lesson

Ginko's opaque server mutation failure led to packed query, mutation, and action lifecycle certification plus documentation for allowlisted application telemetry. It did not justify a second general inspector, raw-cause logger, or application callback API.

That decision carries forward:

- `ConvexCallError.cause` remains non-enumerable and absent from serialization;
- applications MUST NOT return or log raw causes wholesale;
- packed production consumers MUST prove query, mutation, and action failures;
- safe telemetry uses explicit allowlisted fields;
- new public diagnostic hooks require separate proof that existing telemetry cannot solve the problem.

### Safe MCP diagnostics

The MCP integration MAY emit server-only diagnostics containing mechanically derived metadata such as:

```text
local call ID
operation kind
official tool name
official Convex function name, when configured as non-sensitive
protocol version
negotiated feature name
safe classification
cause class name
presence of structured Convex data
HTTP status category
duration bucket or bounded duration
terminal result category
```

Diagnostics MUST NOT contain:

- function arguments;
- tool input values;
- raw tool results;
- `Authorization` headers;
- cookies;
- OAuth tokens;
- Convex JWTs;
- Better Auth session values;
- provider authorization references;
- internal service proofs;
- review URLs or opaque locators;
- raw `Error` objects;
- `error.message` or `error.stack` from unknown causes;
- upstream response bodies;
- private user or tenant data.

Diagnostics MUST be incapable of changing success, failure, authorization, or protocol behavior. Logging failure is non-authoritative and fail-open with respect to observability only.

### Correlation and tracing

A local call ID MAY be generated before invocation. It MUST be random, non-secret, bounded, and contain no encoded identity, IP address, argument, credential, or timestamp that exposes deployment detail.

The implementation SHOULD adopt the final MCP specification's standard trace-context behavior if retained in the final release and supported by the official SDK. Trace baggage MUST be filtered; it is not an unrestricted metadata channel.

Correlation IDs, MCP request IDs, task IDs, elicitation IDs, and application operation IDs have different ownership. They MUST NOT be substituted for one another or treated as authority.

### Public caching

Authentication, token exchange, private MCP results, diagnostics, and review pages MUST use cache behavior appropriate to private identity-bound data. Better Convex MUST preserve `private, no-store` for token and authenticated HTML/HTTP responses where caching could cross identities.

MCP discovery and list caching MAY use the final specification's cache metadata only after verifying that the response is safe for its declared cache scope. Tool lists or resources that differ by subject, client, scope, tenant, or policy MUST NOT be marked shareable across those boundaries.

## Security and threat model

### Attacker capabilities

The design assumes a malicious or buggy MCP host, client, model, tool input, browser link opener, application user, OAuth client, service, and network peer within the limits of TLS and deployed platform guarantees.

An attacker may attempt to:

- call a tool without presenting a human confirmation;
- lie about tool annotations;
- alter or replay arguments;
- retry writes after timeout;
- retain an access token until expiry;
- send a token for another resource;
- substitute a Convex session JWT, ID token, or another signed token class;
- exploit scope, audience, issuer, client, or subject confusion;
- use caller-supplied user or tenant identifiers;
- invoke another Convex function through a generic dispatcher;
- forward a review URL to another account;
- cause a crawler or preview service to open a review URL;
- double-submit or race a confirmation;
- change canonical state between preview and execution;
- inject content into model-visible tool results;
- trigger oversized, compressed, malformed, or aborted requests;
- extract secrets from errors, logs, URLs, source maps, artifacts, or iframe state;
- access another caller's task, review, resource, or receipt;
- exploit stale Vue callbacks or identity transitions;
- make a published tarball differ from tested source.

### Required defenses

The system MUST enforce:

1. exact MCP resource audience and issuer validation;
2. token-class separation;
3. bearer verification on every protected HTTP request;
4. no token passthrough;
5. explicit tool and function allowlists;
6. exact schemas and bounded inputs/outputs;
7. current application authorization;
8. tenant and resource checks from canonical state;
9. identity-generation fencing in Vue/Nuxt;
10. inert review `GET` requests;
11. opaque non-capability review URLs;
12. same-initiator handoff integrity plus separately identified application approvers;
13. transactional local review consumption and mutation effect;
14. application idempotency for non-idempotent retries;
15. external-provider idempotency and reconciliation;
16. safe error and diagnostic projection;
17. CSP, sandbox, and capability limits for MCP Apps;
18. task authorization on every request;
19. per-request SSR and server-call isolation;
20. exact installed-artifact verification.

### Confused-deputy rules

Better Convex MUST NOT:

- let a service silently inherit a browser user's authority;
- let a browser session silently satisfy an MCP access-token requirement;
- let a coarse MCP scope bypass application membership;
- let the MCP server use its own broad service authority without carrying and re-resolving delegated caller context;
- let a review locator grant approval authority;
- let an MCP App bypass the tool/resource authorization path;
- let an authorization server token intended for another API reach the MCP resource;
- let a valid MCP token be forwarded to a downstream API.

### Revocation model

Cryptographic token revocation and application authorization revocation are distinct.

The design MUST make membership removal, role downgrade, credential disablement, resource unlinking, and application delegation revocation effective on the next protected operation through live state checks. It MUST NOT claim that a self-contained JWT is individually blacklisted unless the deployed token profile actually implements and proves that mechanism.

Short access-token lifetimes reduce residual bearer exposure but do not replace live application authorization.

### Security properties not promised

Better Convex does not promise:

- that an MCP host always shows a confirmation;
- that model-generated explanations are accurate;
- generic exactly-once mutations;
- exactly-once external side effects;
- immediate invalidation of every self-contained access token without live state checks;
- protection from an application that intentionally exposes an unsafe tool;
- protection from application authorization that trusts caller-controlled fields;
- secrecy of information the application deliberately returns in tool output;
- task cancellation after an effect has committed.

## Ginko CMS alignment

### Role of Ginko

Ginko CMS is the first proving consumer for this architecture. It is not the source of Better Convex public abstractions.

Ginko is valuable because it exercises hard, real use cases:

- an embedded Vue/Vite Studio inside a Nuxt host;
- duplicated query, pagination, mutation, and action lifecycle;
- a real tools/resources/prompts surface;
- authenticated server-to-Convex calls;
- current membership, role, credential, and scope checks;
- contract compatibility;
- application-owned previews and publish review;
- concurrency-sensitive canonical publishing;
- packed-consumer and live certification.

An API moves into Better Convex only when it solves the same infrastructure problem for Ginko and a non-CMS consumer. CMS policy remains in Ginko.

### Ginko evidence baseline

Migration assumptions in this RFC were checked against this immutable Ginko baseline:

```text
Repository: https://github.com/lupinum-dev/ginko-cms
Inspection checkout: /Users/matthias/Git/workspace/ginko-cms
Branch: codex/latest-libs-migration
Commit: a760bfd03d5fc444c05d745df5d1212370cd1ecd
Worktree at inspection: clean
```

Canonical review and authorization evidence:

- `packages/convex/src/reviewRequests.ts`
- `packages/convex/src/entries/publicationApproval.ts`
- `packages/convex/src/auth/checks.ts`
- `packages/convex/src/schema.ts`
- `playground/convex/ginkoCms/reviewRequests.ts`
- `packages/cms/src/server/mcp/tools/content/request-publish-review.ts`
- `packages/cms/src/server/mcp/tools/content/preview-publish.ts`
- `packages/cms/src/server/mcp/tools/content/get-review-status.ts`
- `docs/guides/mcp-agent-workflows.md`

Canonical MCP bridge evidence:

- `packages/cms/src/server/middleware/mcp-auth.ts`
- `playground/convex/ginkoCms/mcpCaller.ts`
- `packages/contract/src/caller.ts`
- `adr/0007-mcp-is-opt-in-first-class-cms-surface.md`
- `adr/0006-studio-and-mcp-do-not-mutate-schema.md`

Canonical embedded Studio lifecycle evidence:

- `packages/cms/studio-app/src/composables/useCmsStudioQuery.ts`
- `packages/cms/studio-app/src/composables/useCmsStudioPaginatedQuery.ts`
- `packages/cms/studio-app/src/composables/useStudioConvex.ts`
- `test/runtime/studio-operation-scope.test.ts`

The baseline creates a pending review with `requestedBy`, denies MCP-origin approval, and requires a current browser actor with `canPublishEntries`. It does **not** require `reviewedBy !== requestedBy` and has no pre-review handoff state. Any later Ginko change that affects these facts requires an RFC evidence-ledger update before migration claims are reused.

### Ginko invariants that survive migration

1. Collection schema and application configuration remain code-defined. Studio and MCP cannot mutate them.
2. MCP remains explicitly opt-in.
3. Tools expose narrow CMS operations, not raw tables, arbitrary functions, membership administration, or deployment controls.
4. OAuth scopes or integration scopes remain delegation ceilings.
5. Current CMS membership, role, credential status, resource access, and contract compatibility are checked at execution.
6. Draft writes do not alter public output.
7. Publish-review creation does not alter public output.
8. Publish approval recomputes current state, rejects stale impact, checks current reviewer permission, and applies publication transactionally.
9. Secrets, assertions, tokens, cookies, provider authorization references, raw causes, and response bodies do not enter MCP results, Vue state, logs, or review URLs.
10. Contract compatibility, editorial workflow, readiness rules, public-impact computation, audit, and outbox remain Ginko-owned.
11. An agent-run ID, review ID, request ID, task ID, or MCP protocol identifier is not authority by itself.

### Target Ginko architecture

```text
MCP host
  → standard MCP resource and OAuth boundary
  → verified MCP access context
  → explicit Ginko tool
  → explicit Ginko Convex facade
  → current Ginko actor resolution
  → current CMS authorization
  → canonical Ginko component function
  → canonical CMS state
```

```text
Nuxt host
  → opaque Better Convex runtime handle
  → embedded Vue Studio
  → shared Better Convex query/callable controllers
  → thin Ginko permission and contract adapter
  → canonical Ginko Convex functions
```

No JWT, Better Auth cookie, OAuth access token, or refresh capability crosses the embedded Studio integration API.

### Generic client code Ginko should delete

After `better-convex-vue` passes Ginko's existing behavior tests, Ginko SHOULD delete:

- direct `convex.onUpdate()` subscription ownership;
- query generation and stale-callback bookkeeping;
- pagination request and subscription generation counters;
- in-flight cursor bookkeeping;
- first-page tail replay owned outside the shared controller;
- duplicated mutation and action status machines;
- manual authentication-settlement polling;
- duplicated identity-change retirement;
- duplicated generic Convex error normalization;
- generic cleanup and disposal code.

Ginko wrappers remain as thin policy adapters containing only:

- CMS capability gates;
- contract-readiness or writability gates;
- CMS-specific error mapping;
- CMS page-metadata selection;
- domain-specific result names where they improve the Studio.

A Ginko invariant test SHOULD fail if direct subscription ownership, cursor-chain ownership, or generic client callable lifecycle/generation bookkeeping is reintroduced outside Better Convex.

### MCP bridge code Ginko should delete

If the Convex-native MCP topology wins, Ginko SHOULD delete:

- Nitro-side HMAC assertion generation;
- the Ginko MCP server secret;
- signed assertion fields in public Convex arguments;
- manual argument stripping and signature verification;
- the anonymous `serverConvex()` identity bridge;
- duplicate Nitro-side MCP authentication replaced by the canonical resource server.

If Nitro-native MCP wins, Ginko SHOULD replace those pieces with the internal Better Convex exact-call mechanism. It MUST NOT maintain its own assertion protocol beside the selected library implementation.

In either topology, the raw MCP bearer terminates at the logical MCP resource and does not become a Convex session token or general function argument.

### Ginko behavior that remains application-owned

Ginko continues to own:

- collections and its generated CMS contract;
- entry, locale, route, SEO, sitemap, navigation, and search semantics;
- memberships, roles, permissions, and capability mapping;
- contract-readable and contract-writable preflight;
- integration-to-member mapping;
- agent-run budgets, attribution, and retention when they are product concepts;
- tool names, descriptions, schemas, outputs, prompts, and resources;
- draft version and optimistic concurrency;
- readiness blockers and warnings;
- publish-impact calculation;
- review-request state and reviewer policy;
- activity records, outbox events, and provider reconciliation;
- which operations require review;
- the exact review screen and confirmation copy;
- whether approval requires the initiator, a second reviewer, or both;
- domain error classification.

Better Convex public vocabulary MUST NOT contain Ginko-specific concepts such as entry, locale, publish, editorial, collection, agent run, CMS role, or reviewer.

### Candidate Ginko simplifications requiring evidence

The following are not automatic deletions:

- agent-run records and APIs;
- passing an agent-run ID through writes;
- a Ginko operation-definition helper;
- generic destructive confirmations;
- operation receipts;
- Ginko bearer-credential issuance;
- polling review status.

Decision rules:

- Keep agent runs when they are canonical product records for budgets, attribution, retention, or audit.
- Delete agent runs when they exist only to emulate an MCP transport session or hidden conversation state.
- Never call an agent run an MCP session.
- Keep previews when humans or agents genuinely need impact information.
- Keep ordinary reversible writes direct.
- Use the existing durable review record for high-impact publication rather than adding a second handoff table.
- Keep receipts only when they are the canonical idempotency or audit record.
- Do not duplicate authorization-server token state in Ginko tables.

Any Ginko-local prepare/execute operation that remains after this audit MUST bind one validated argument set across both phases. `execute()` must not accept a material argument that was absent from preparation. In particular, the pinned baseline's publish-message path requires an end-to-end test proving that a non-empty message is prepared and executed with identical bound arguments and that editing it invalidates prepared state. This stays a Ginko invariant; it does not justify a public Commands package.

No Ginko-specific operation abstraction moves into Better Convex without the neutral-consumer gate.

Before the Ginko migration is declared complete, maintainers MUST close this decision ledger against the pinned baseline. “Retain” requires one canonical purpose and an invariant test; “delete” names the removed path. No item may remain as an unexplained compatibility layer.

| Candidate                        | Provisional decision                                                                                                            | Required closure evidence                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Agent-run records                | Retain only for canonical budget, attribution, retention, or audit semantics                                                    | Named owner, retention rule, non-authority test, and deletion of transport-session uses                           |
| Caller-supplied `agentRunId`     | Derive or validate as correlation only; never accept it as actor or permission                                                  | Cross-run and cross-tenant retargeting negatives; delete the argument where no domain purpose remains             |
| Generic confirmations            | Delete for ordinary writes; retain only application review or genuinely inspected impact                                        | Per-operation direct-versus-review decision and test that no hidden prepare/execute symmetry survives             |
| Operation receipts               | Retain only as canonical idempotency, lost-response recovery, or audit records                                                  | Owner, authorization, bounded retention, replay test, or deleted schema/API path                                  |
| Ginko bearer-credential issuance | Hard-cut delegated humans to standard MCP OAuth; keep machine trust separate until its standards profile and clients are proven | Endpoint and data migration, expiry/revocation behavior, and proof that legacy and OAuth are not accepted forever |
| Review-status polling            | Retain only as an authorized read of the canonical review row when clients need recovery                                        | Subject/client/tenant isolation, bounded polling, terminal retention, and no parallel workflow record             |

This ledger is part of the migration gate, not a suggestion to preserve every current concept.

### Ginko pilot A: read-only operation

Use an existing search, entry read, or collection-inspection capability.

Prove:

- exact `tools/list` declaration;
- validated structured result and text fallback;
- authenticated and public visibility rules;
- bounded output;
- resource links for large or URI-addressable output where useful;
- safe not-found and authorization behavior;
- no raw Convex metadata or secret-bearing fields.

### Ginko pilot B: ordinary write

Use `save-entry-draft` or its current canonical equivalent as a normal `tools/call`:

```text
save-entry-draft
  → validate tool schema
  → verify MCP access context
  → check coarse edit scope
  → load current credential, member, and role
  → check current contract and expected draft version
  → one Convex mutation
  → return saved or conflict result
```

Prove:

- no dependency on a host approval prompt;
- role downgrade, membership removal, application credential revocation, or reduction of the current Ginko integration/delegation allowance blocks the next call;
- caller-controlled identity and organization fields cannot retarget the write;
- retries do not create unintended duplicate effects;
- concurrent edits return the existing truthful conflict result;
- public output remains unchanged.

Ginko's effective authorization is the intersection of three live or bounded inputs:

```text
effective permission =
  token scope ceiling
  ∩ current Ginko integration/delegation allowance
  ∩ current member/role/resource permission
```

Reducing the current Ginko mapping takes effect on the next protected operation. Removing only a scope claim already minted into a self-contained token remains bounded by token expiry or certified provider revocation behavior; Better Convex MUST NOT claim otherwise.

### Ginko pilot C: application-owned publish review

Reuse Ginko's existing publish-review workflow. Do not create a Better Convex or second Ginko handoff table.

```text
request_publish_review
  → authenticate and authorize request creation
  → compute current impact
  → create the existing Ginko review request
  → return a structured receipt and inert authenticated-Studio locator
  → current authorized reviewer enters the canonical review queue
  → reviewer approves or rejects under current application policy
  → approval recomputes stale state and authority
  → publish and review decision commit together
  → retry carrying the review ID or status reads the same canonical row
```

This creation is an ordinary MCP write. The existing Ginko reviewer policy is preserved:

- the MCP caller is recorded as requester;
- a current publisher or owner may approve through the application workflow;
- unauthorized users cannot approve;
- requester and reviewer are recorded separately but may be the same human;
- adopting true four-eyes approval later requires a separate Ginko product decision, schema/state migration, distinct-human enforcement, and negative tests.

The locator performs no mutation on `GET` and grants no reviewer authority. Approval occurs only through the authenticated application mutation.

URL elicitation is optional here, not the semantic creation or approval protocol. It MAY be offered when the initiating user has a meaningful action to perform in Studio, such as personally reviewing and deciding the request. In that mode, the initiating user must satisfy the same-user elicitation rules. A different reviewer enters the ordinary Ginko review queue; that reviewer does not complete the requester's elicitation. Clients without URL elicitation receive the same safe locator and review ID in a structured result. A review-status tool MAY remain if it reads the same canonical review row and does not create parallel workflow state.

Before the canonical review row is used for MCP retry/status projection, Ginko MUST either extend that row or document an immutable derivation through the canonical agent-run/integration record for:

- MCP issuer and subject;
- client and resource;
- operation and argument or target binding;
- interaction expiry, only when URL elicitation is actually created;
- requester authorization for status lookup.

Legacy rows remain valid for the existing application review workflow but MUST NOT become MCP-resumable merely through guessable or unbound IDs. No second handoff table is introduced. The migration must define backfill behavior, retention coupling for any derived provenance, and the single owner of status transitions.

### Ginko pilot D: Vue MCP App

Use publish-impact preview as a view-oriented MCP App:

- display affected locales and public URLs;
- show blockers, warnings, route changes, and version information;
- allow safe navigation to the normal authenticated Studio review queue without treating `ui/open-link` as URL-elicitation consent;
- call tools only through App Bridge;
- provide equivalent useful text for unsupported hosts.

The iframe receives no Convex JWT, Better Auth session, OAuth bearer, internal signing key, or unrestricted Convex client. Final approval remains in the authenticated Studio.

### No Ginko Tasks pilot in the first release

Agent runs, reviews, revalidation, and publication MUST NOT be converted into MCP Tasks before the final extension and SDK are stable.

A later long-running reindex or migration job may be projected as an MCP Task. The Ginko job remains canonical.

### Ginko OAuth migration

Ginko's current bearer credentials are useful evidence for application-owned credential revocation and authorization, but they should not remain the final public remote-MCP authorization protocol.

Human-delegated clients SHOULD migrate through one hard cutover to:

- standard MCP OAuth authorization;
- Better Auth as the initial authorization server;
- Protected Resource Metadata and authorization-server discovery;
- PKCE and exact redirect handling;
- exact MCP resource audience;
- strict issuer, token-class, client, expiry, and scope validation;
- current application revocation checks.

Ginko MAY retain an application integration mapping keyed by stable verified external identity. It MUST NOT duplicate Better Auth token storage.

Machine credentials remain a separate trust model until the official MCP client-credentials extension and real clients are proven. Ginko MUST NOT accept legacy bearer secrets and OAuth access tokens indefinitely on one endpoint.

### Ginko migration order

1. Freeze current tool schemas, Studio behavior, review invariants, packed artifact, and live proof.
2. Replace Studio query, pagination, mutation, and action lifecycle internals with `better-convex-vue`.
3. Retain thin Ginko contract, capability, metadata, and error adapters.
4. Complete the Convex-versus-Nitro official-SDK proof.
5. Replace Ginko MCP transport and authentication plumbing with the chosen Better Convex path without changing domain semantics.
6. Migrate one read and one ordinary write.
7. Adapt the existing canonical publish-review queue to MCP receipts/status; add same-user URL elicitation only where the requester performs a meaningful Studio action.
8. Add the optional publish-impact MCP App.
9. Delete legacy client-lifecycle, MCP transport, auth, and bridge code.
10. Run the same primitives and conformance suite against a neutral second consumer.
11. Certify exact packed artifacts in production Vite, Nitro, and live staging.

### Neutral second consumer

Ginko alone cannot justify a public abstraction. Use a non-CMS application, initially the neutral agentic SaaS starter, with different domain objects and reviewer policy:

```text
list_products     read-only tool
rename_product    ordinary write
delete_product    high-impact URL handoff
```

The neutral deletion example SHOULD use direct same-subject URL confirmation, while Ginko preserves its application-owned review queue and permits any current authorized publisher or owner according to its existing policy. This proves that Better Convex provides secure composition points rather than one hardcoded workflow.

The extraction gate is:

1. Both consumers use the same primitive without application-name branches.
2. Public types and documentation contain no Ginko or CMS vocabulary.
3. The same conformance suite passes for both.
4. The authorization matrix includes Better Auth and an external verifier fixture.
5. The second consumer uses different domain objects, permissions, and review copy.
6. Ginko deletes its measured duplicate client/MCP infrastructure; the repository-owned neutral fixture is not required to invent code merely so it can delete it.
7. Neither adds a second source of truth to satisfy the library.
8. The neutral consumer first implements its domain operation directly, then demonstrates that the shared adapter removes repeated protocol glue without creating another source of truth.
9. A feature needed only by Ginko remains in Ginko.
10. Failure of the neutral consumer blocks public stabilization, not Ginko's application release.
11. A repository-owned starter proves neutrality and conformance, not independent market demand; any workflow-shaped public API requires an independent external adopter before stable release.

## Implementation and proof plan

### Phase 0: complete the 0.7 baseline

Scope:

- finish the current `0.7.0-beta.1` certification and release process;
- preserve the hardened dependency tuple and OAuth profile;
- record current MCP protocol evidence honestly as selected `2025-11-25` coverage;
- make no monorepo, Vue, MCP Apps, Tasks, Commands, or topology rewrite a 0.7 release requirement.

Exit criteria:

- final 0.7 tree is clean;
- exact candidate tarball is bound to its commit and non-placeholder runtime fingerprint;
- package SHA-256, SRI, SBOM, content manifest, dependency tuple, and cloud evidence are recorded;
- current docs distinguish delegated-human and private service-actor MCP trust models;
- no unfinished vNext public export leaks into the package.

Abort rule: a security or correctness defect in 0.7 takes precedence over vNext work.

### Phase 1: final-spec reconciliation and MCP laboratory

Begin fixture preparation before 2026-07-28, but do not claim or stabilize `2026-07-28` support until the final specification and compatible official TypeScript SDK are published.

Build one neutral fixture with:

```text
search_notes        read-only tool
rename_note         ordinary idempotent write
delete_workspace    high-impact URL handoff
generate_report     long-running candidate, immediate result initially
note://<id>          resource or resource template
notes-dashboard     Vue MCP App
```

Implement the identical application semantics in the Convex-native and Nitro-native candidate topologies. Do not create a general abstraction to hide their differences during the probe.

Evidence must cover:

- final protocol discovery and request lifecycle;
- Streamable HTTP or its final replacement behavior;
- tools, resources, structured results, and errors;
- OAuth discovery, audience, challenge, and revocation;
- URL interaction;
- MCP Apps;
- abort, timeout, and bounded resource behavior;
- exact production deployment;
- official conformance tooling;
- MCP Inspector;
- real compatible hosts;
- safe diagnostics;
- concurrent callers and identity isolation.

Exit criterion: write a short topology decision record naming the winner, failed gates of the loser, operational consequences, and files to delete. No MCP package implementation begins until this decision is accepted.

Abort rule: if neither topology can pass the mandatory official SDK and protocol gates without a custom protocol fork, stop the MCP package and continue supporting the current 0.7 beta profile while escalating the runtime gap upstream.

### Phase 2: workspace and release-certification groundwork

Scope:

- keep the published `better-convex-nuxt` package at the repository root;
- introduce workspace support without enabling a second publication;
- create a static allowlisted package-certification descriptor;
- generalize artifact paths and evidence identity to include package name and directory;
- run the existing Nuxt release through the generalized certifier;
- preserve current security governance and dependency tuple checks;
- establish per-package exact-artifact manifests.

Rules:

- no move to `packages/nuxt` for symmetry;
- no repository rename in this phase;
- no arbitrary package-directory input to release CI;
- no weakening of Nuxt-specific DevTools, auth, OAuth, DAST, provenance, fingerprint, candidate-app, or cloud gates;
- no catch-all meta-package;
- no public core package;
- no unrelated runtime behavior changes in the structural commit.

Exit criteria:

- the root Nuxt package's public exports and packed behavior match the pre-change candidate;
- exact tarball comparison and maintained Nuxt consumer matrix pass;
- package evidence records package identity, directory, manifest contract, artifact hashes, and applicable runtime profile;
- repository checks identify unintended cross-package dependencies;
- the generalized certifier is at least as strict as the current Nuxt release path.

### Phase 3: private Vue-boundary proof

Order:

1. stable client ownership;
2. identity key and generation;
3. query controller;
4. callable controller;
5. pagination controller;
6. cleanup and disposal;
7. one dependency rule excluding Nuxt, Nitro, H3, and Better Auth from the extracted source island;
8. public Nuxt composables adapted to that source;
9. a plain Vite fixture using the same source.

The public Nuxt API remains compatible unless a separately approved breaking change is required to eliminate duplicate execution gates.

Exit criteria:

- existing Nuxt unit, browser, SSR, hydration, auth, identity-switch, pagination, mutation, action, optimistic-update, and error tests pass;
- no duplicate experimental Vue implementation exists beside the Nuxt-used source;
- source and bundle inspection show one controller source per lifecycle;
- a packed Nuxt consumer proves behavior, not only types.

Abort rule: if the extraction requires weakening SSR isolation, identity generation, or stale-result retirement, revert the extraction and redesign it before adding Vue.

Before publishing a new Vue package, maintainers SHOULD compare the required invariants with the existing Convex Vue ecosystem and seek upstream collaboration where it can preserve the security and lifecycle contract. A new package is warranted only when Nuxt and a real plain-Vue consumer need semantics that cannot be safely supplied through the existing upstream path.

### Phase 4: publish `better-convex-vue` and hard-cut Nuxt

Scope:

- move the proven source island once into `packages/vue`;
- Vue plugin and injection context;
- anonymous mode;
- provider-neutral auth adapter;
- query, pagination, mutation, and action composables;
- embedded runtime mode;
- Vite production fixtures;
- same result and error semantics where Nuxt-specific SSR does not differ;
- make the root Nuxt package depend on the exact planned Vue release version before either candidate is built;
- delete the Nuxt-owned client runtime;
- build the immutable Vue and Nuxt candidates once and certify the pair before publication;
- publish and registry-verify Vue, then reinstall the unchanged Nuxt candidate against that registry Vue version;
- publish the unchanged Nuxt candidate only after the registry-installed pair passes;
- rebrand documentation and, after the package cutover passes, rename the repository to Better Convex.

Required consumers:

- standalone anonymous Vue/Vite app;
- standalone authenticated Vue/Vite app;
- embedded Vue application using an opaque host runtime;
- Ginko Studio migration fixture.

Exit criteria:

- no Nuxt, Nitro, H3, Better Auth server, or MCP server dependency in the plain Vue build;
- identity transitions synchronously retire protected state;
- query and pagination race tests pass through the shared controller;
- embedded applications receive no tokens or secrets;
- Ginko deletes its generic lifecycle implementation;
- exact packed Vite production builds pass;
- the Nuxt consumer installs both exact tarballs rather than workspace links;
- the packed Nuxt manifest contains the exact registry Vue version;
- installed bytes match both approved candidates;
- no old Nuxt client engine remains.

### Phase 5: base `@better-convex/mcp`

Scope:

- selected official-SDK-backed topology;
- tools and resources;
- safe access context;
- provider-neutral verifier contract;
- Better Auth resource-server adapter or integration;
- structured result and error integration;
- explicit Convex call mapping;
- safe diagnostics;
- baseline text fallbacks;
- official and Better Convex conformance.

Excluded from this phase:

- URL handoff storage framework;
- MCP Apps Vue package surface;
- Tasks;
- public service-proof product;
- automatic tool generation;
- authorization DSL.

Exit criteria:

- one read and one ordinary write pass in the neutral fixture and Ginko;
- Better Auth and an external verifier fixture pass;
- token passthrough tests pass by proving absence;
- exact packed MCP and framework consumers pass;
- the old hand-written protocol parser is removed from the supported implementation;
- the losing topology is absent.

### Phase 6: URL elicitation and application review projection

Scope:

- capability-aware projection of application interaction records;
- safe URL construction from a fixed origin and opaque ID;
- final protocol interaction result/request mapping;
- completion and retry integration;
- neutral same-subject deletion example;
- Ginko canonical review-queue receipt, locator, and status adapter.

Better Convex does not own a handoff table in this phase. Each example uses its existing application-owned canonical operation record.

Exit criteria:

- same-user phishing and forwarded-link tests pass;
- Ginko records requester and reviewer separately without inventing a distinct-human requirement;
- `GET`, prefetch, crawler, expiry, stale, replay, and concurrency tests pass;
- clients without URL interaction receive a no-URL unsupported result for direct same-user handoff; ordinary application queues may still return their inert locators;
- neither consumer has parallel approval state;
- common protocol projection code contains no domain vocabulary.

### Phase 7: Vue MCP Apps

Scope:

- official MCP Apps SDK integration;
- Vue composables and scope disposal;
- server registration/resource support through the MCP package;
- neutral dashboard, form, and preview examples;
- Ginko publish-impact preview;
- progressive structured and text fallback.

Exit criteria:

- capability negotiation controls app delivery;
- CSP, sandbox, and permissions are explicit;
- no auth credential, internal proof, or raw Convex client reaches the iframe;
- all app-initiated calls pass through ordinary MCP authorization;
- unsupported hosts retain useful behavior;
- exact bundled UI-resource evidence passes in production.

### Phase 8: optional Tasks and machine clients

This phase begins only when:

- the final base protocol is published;
- the official Tasks extension version is stable enough for the selected SDK;
- at least two relevant clients support it;
- one real application job benefits materially from deferred result retrieval;
- the baseline structured status result is insufficient.

Scope:

- application-job-to-Task projection;
- `tasks/get`, `tasks/update`, and `tasks/cancel` as defined by the final extension;
- task auth binding and retention;
- optional official OAuth Client Credentials extension after separate interoperability proof.

Exit criteria:

- no second job source of truth;
- no `tasks/list` or legacy Tasks compatibility layer in the final-version path;
- access isolation, polling, expiry, cancellation, and concurrency pass;
- Ginko uses a genuine long-running job rather than converting an existing short mutation for demonstration.

Tasks do not block Better Convex 1.0.

### Phase 9: 1.0 stabilization

Better Convex 1.0 is eligible when:

- Vue and Nuxt share one client-lifecycle source;
- the selected MCP topology is singular and official-SDK-backed;
- latest-final MCP conformance passes;
- normal tools work in real clients;
- Better Auth and one external verifier path are proven;
- URL handoff passes security and concurrency evidence;
- MCP Apps degrade correctly;
- Ginko and a neutral consumer delete meaningful custom infrastructure;
- exact packed packages pass production consumers;
- a fresh offensive-security review finds no unresolved high-impact invariant failure;
- all accepted public APIs have stable ownership and documentation.

## Conformance and evidence matrix

### Version and capability evidence

| Requirement                                                                    | Source       | Evidence                                               |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------ |
| Every release records exact protocol, SDK, extension, and conformance versions | `[BCN]`      | Release manifest and installed package inspection      |
| Capabilities are advertised only when implemented                              | `[MCP-2025]` | Negative and positive capability tests                 |
| Behavior branches on negotiated standards data, never host user agent          | `[BCN]`      | Source sentinel plus host matrix                       |
| Legacy and stateless lifecycles are not combined                               | `[BCN]`      | Official SDK configuration and protocol matrix         |
| Unsupported optional features return safe baseline behavior                    | `[BCN]`      | Tools, URL interaction, Apps, and Tasks fallback tests |
| `2026-07-28` is claimed only after final publication                           | `[BCN]`      | Release governance check                               |

If the package supports both `2025-11-25` and `2026-07-28`, the official SDK MUST own both paths. Better Convex MUST NOT retain its own legacy session engine.

### HTTP transport evidence

For any supported `2025-11-25` path, tests MUST cover the final specification's Streamable HTTP requirements, including UTF-8 JSON-RPC, valid `Accept`/`Content-Type`, required method behavior, session semantics where applicable, and `Origin` validation. Invalid origins return `403`. Local development binds to loopback by default.

For the `2026-07-28` target, subject to final-spec confirmation, tests MUST cover:

- protocol version and per-request metadata;
- absence of dependency on `initialize`, `initialized`, and `Mcp-Session-Id`;
- `server/discover`;
- required routing headers such as `Mcp-Method` and `Mcp-Name` if retained;
- disagreement between routing headers and body;
- server-to-client requests only while processing the initiating client request;
- explicit application handles instead of hidden protocol sessions;
- independent authentication-context reconstruction for every request;
- cache metadata scoped to the correct authorization context.

All supported paths MUST test:

- path and method equality between authorization and execution;
- header allowlists and hop-by-hop removal;
- duplicate or conflicting length and transfer metadata;
- unsupported content encoding;
- oversized request and response bodies;
- aborts, disconnects, and timeouts;
- bounded SSE or final-version streaming behavior;
- concurrent callers;
- no mutable request identity in module-global state.

Reference: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

### OAuth evidence

| Scenario                       | Expected evidence                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Protected Resource Metadata    | Correct canonical resource and authorization-server list                                                 |
| Authorization-server discovery | OAuth metadata and OIDC discovery fixtures where applicable                                              |
| Resource indicator             | Present in authorization and token requests                                                              |
| Audience                       | Exact logical MCP resource accepted; all others rejected                                                 |
| Issuer                         | Exact issuer accepted; mix-up and changed issuer rejected                                                |
| PKCE                           | S256 required; absent, plain, and mismatched verifier rejected                                           |
| Redirect                       | Exact registered redirect required, with only standards-permitted loopback behavior                      |
| Bearer location                | Header accepted; query and body token transport rejected                                                 |
| Missing/invalid token          | `401` with correct resource discovery challenge                                                          |
| Insufficient scope             | `403` and standards-conforming minimum-scope challenge                                                   |
| Token classes                  | Convex session, ID token, foreign access token, and malformed token rejected                             |
| Registration                   | Preregistered or metadata-document path proven; DCR only if explicitly supported                         |
| Refresh                        | Not advertised when disabled; rotation/reuse/revocation tested before enablement                         |
| Application revocation         | Membership, role, application delegation, and application credential changes block the next operation    |
| Provider grant revocation      | Next-call session/client/consent denial for live-state adapters; documented token-expiry bound otherwise |
| Provider neutrality            | Better Auth plus one external verifier fixture                                                           |
| OAuth administration           | Mandatory fail-closed Better Auth privilege callbacks remain release-gated                               |

Authorization-code concurrency MUST be executed: two simultaneous redemptions of one code yield at most one token issuance.

### Tool evidence

Every tool fixture MUST prove:

- discovery shape and exact schema;
- valid call and validated output;
- unknown tool protocol error;
- malformed JSON-RPC protocol error;
- correctable input failure as a tool execution failure;
- expected domain result;
- downstream actionable failure as a sanitized tool execution error;
- MCP server/infrastructure failure as a sanitized JSON-RPC server/internal error;
- minimum scope challenge;
- current application authorization;
- wrong tenant and caller-controlled authority rejection;
- accurate but non-authoritative annotations;
- bounded results;
- no credential or raw-cause serialization;
- retry and idempotency behavior matching the annotation.

The suite MUST include at least one read, one idempotent write, one non-idempotent write with explicit application policy, and one denied cross-resource attempt.

### Nitro internal-proof evidence

If the Nitro topology wins, the executed suite MUST include:

- exact valid query, mutation, and action wrappers;
- sequential and concurrent replay of the same proof against mutation and action wrappers;
- operation-kind, function-name, argument, audience, issuer, and service substitution;
- expired and not-yet-valid proof;
- unknown, retained-rotation, and retired key IDs;
- algorithm mismatch and unknown claim rejection;
- reserved-envelope collision and proof-field injection;
- canonical-argument cross-runtime vectors;
- proof and provider-authorization-reference absence from results, logs, diagnostics, and serialized errors;
- a named application idempotency or transactional replay invariant for every non-idempotent wrapper.

This matrix proves replay behavior; it does not create a generic exactly-once claim.

### URL-interaction evidence

The executed matrix MUST include:

- supported and unsupported client capabilities;
- valid initiating user;
- unauthenticated browser;
- wrong browser user;
- same email under another issuer;
- forwarded link;
- malformed, guessed, expired, consumed, rejected, and cancelled locator;
- link scanner, prefetch, and plain `GET`;
- current role downgrade or membership removal before confirmation;
- application credential/delegation revocation before confirmation, plus authorization-server consent revocation for live-state provider adapters;
- target deletion or impact change before confirmation;
- double click and concurrent confirmation;
- lost, delayed, duplicate, and reordered completion notifications;
- retry with the explicit interaction/operation key after application completion;
- status lookup isolation;
- private caching, CSRF, clickjacking, and referrer policy;
- no sensitive data in URL, HTML, logs, result, or serialized error;
- direct same-user interaction rejection for another user;
- application reviewer-queue access by the same or a different currently authorized reviewer without rebinding the requester;
- Ginko requester and reviewer recorded separately, with no unimplemented distinct-human claim.

### MCP Apps evidence

The executed matrix MUST include:

- extension negotiated and absent;
- valid `ui://` resource registration;
- exact UI metadata and declared CSP;
- sandboxed rendering;
- theme/context update;
- tool input before and after mount;
- tool result and repeated result update;
- app-initiated allowed and denied tool calls;
- denied external-link capability;
- `ui/open-link` does not substitute for URL elicitation or grant approval authority;
- forged or wrong-source App Bridge messages are rejected by Better Convex code when it wraps message transport, otherwise covered by the official extension conformance suite;
- malicious tool-result content;
- unmount and disposal;
- host reconnect or repeated initialization behavior defined by the final SDK;
- text and structured fallback for model-visible launching/accompanying tools;
- absence of tokens, cookies, provider authorization references, proofs, raw causes, and raw Convex clients from DOM, messages, logs, resources, and bundles.

### Tasks evidence

When Tasks is implemented, the matrix MUST include:

- extension negotiated and absent;
- server-selected immediate result versus task result;
- durable task creation followed by immediate `get`;
- authorized and unauthorized `get`, `update`, and `cancel`;
- cross-subject, cross-client, and cross-resource access denial;
- unguessable IDs and no enumeration API;
- polling hints and abusive-poll limits;
- working, input-required, completed, failed, and cancelled behavior supported by the final extension;
- completed actionable tool error versus protocol-level failed-task distinction;
- form and URL `inputRequests` capability negotiation, schema validation, same-user URL binding, and sensitive-form prohibition;
- repeated `inputRequests` across polls/notifications deduplicated without repeating application effects;
- duplicate update;
- cancel/complete race;
- authorization revocation while active;
- TTL expiry and retention cleanup;
- safe status messages;
- canonical application job unchanged by MCP projection removal.

### Vue and Nuxt evidence

The shared lifecycle suite MUST run through:

```text
Nuxt browser
Nuxt SSR and hydration
plain Vue/Vite
embedded Vue/Vite
```

It MUST cover:

- anonymous bootstrap;
- authentication settlement;
- sign-in, refresh, revocation, sign-out;
- Alice-to-anonymous and Alice-to-Bob transitions;
- same-user new identity generation;
- operation generation captured before authentication settlement;
- query argument and gate changes;
- stale subscription callbacks;
- pagination first-page changes and tail reconciliation;
- empty pages with continuation cursors;
- mutation/action completion after identity change rejects the awaited caller path, not only the reactive update;
- reset, cancellation, and disposal retire pending completions;
- callback exceptions cannot rewrite committed success or replace the original normalized failure;
- attached runtimes work across separately installed Vue copies without polling;
- optimistic updates;
- error serialization;
- cleanup exactly once;
- multiple independent application roots;
- concurrent SSR request isolation;
- production build and exact installed package bytes.

### Ginko evidence

Ginko migration is complete only when:

- the embedded Studio consumes an opaque runtime and never a token;
- old-generation results cannot update the current user;
- Ginko no longer owns generic subscriptions, cursor generations, or callable lifecycle;
- every retained Ginko preview/callable path uses the shared lifecycle rather than a raw replaceable Convex client;
- official MCP conformance and OAuth discovery pass through exact packages;
- current credential revocation, member removal, role downgrade, tenant crossing, and contract incompatibility fail closed;
- the ordinary draft write succeeds without a host confirmation dependency;
- expected-version conflicts remain truthful and structured;
- retained Ginko prepare/execute paths bind identical arguments, including a non-empty publish message, and edits invalidate prepared state;
- review creation changes no public state;
- the review URL contains no credential, PII, argument, or authority;
- requester and reviewer are separately recorded and current Ginko policy permits either the same or different authorized human;
- stale, expired, rejected, approved, and concurrent review behavior is correct;
- publication, projections, review decision, activity, and outbox commit or roll back according to Ginko's canonical transaction design;
- the MCP App cannot bypass application review;
- legacy client and MCP bridge implementations are deleted;
- the same Better Convex primitives pass the neutral second consumer.

## Exact-artifact and supply-chain contract

The monorepo MUST retain the current one-immutable-artifact discipline for every public package.

Release automation MUST select from a reviewed static package descriptor rather than accept an arbitrary workspace path. Each descriptor defines:

```text
package name
package directory
build profile
export contract
allowed and required packed files
SBOM profile
provenance profile
candidate-test profile
runtime-fingerprint profile, when applicable
```

Artifacts SHOULD use a package-qualified layout:

```text
.release-artifacts/<package-slug>/<version>/
  <canonical-npm-tarball>.tgz
  contents.json
  sbom.cdx.json
  artifact.json
```

Package profiles remain strict. They MUST NOT be weakened into one permissive union merely to share scripts.

Each release candidate records:

- clean source commit;
- package name and version;
- exact dependency tuple;
- official MCP SDK and extension versions where applicable;
- supported MCP protocol revision;
- conformance-suite revision;
- tarball SHA-256;
- SRI;
- content manifest;
- SBOM;
- runtime fingerprint where the package has executable runtime integration;
- packed file inventory;
- maintained consumer results;
- protected staging evidence.

Required packed consumers include:

```text
better-convex-nuxt
  → production Nitro SSR/auth lifecycle

better-convex-vue
  → production Vite anonymous and authenticated apps
  → production embedded Vue app

@better-convex/mcp
  → selected production MCP runtime
  → OAuth and protocol conformance
  → URL interaction fixture

better-convex-vue/mcp-app
  → production bundled UI resource
  → supporting host and fallback fixture
```

Tests MUST install manifest-selected tarballs rather than resolve workspace source. Lockfiles MUST reference the selected tarballs. Installed package bytes MUST be compared with extracted candidate bytes. A source test does not certify a published artifact.

When Nuxt depends on Vue, publication follows dependency order:

1. select both versions and make the Nuxt packed manifest name the future exact Vue registry version;
2. build both immutable candidate tarballs once;
3. install and certify the candidate pair together, substituting only the exact Vue candidate tarball for the not-yet-published exact version, and record both candidate hashes;
4. complete every candidate-set test before the first publication;
5. publish Vue under a non-default staging dist-tag and byte-compare its registry tarball with the approved Vue candidate;
6. run the mandatory post-Vue/pre-Nuxt registry gate by installing the **unchanged** Nuxt candidate in an isolated consumer where its exact Vue dependency resolves from the verified registry tarball;
7. record Vue registry integrity and the unchanged Nuxt candidate hash in Nuxt evidence;
8. publish that unchanged Nuxt tarball without rebuilding or repacking it;
9. compare the published Nuxt registry tarball with its approved candidate.

npm publication is not atomic. No Nuxt candidate is created or modified after Vue publication. The initial Vue publication MUST NOT update `latest` or another shared user-facing dist-tag; shared dist-tags move only after every package in the set has matching registry bytes.

A release MUST NOT contain a placeholder runtime fingerprint or undocumented generated output. The registry tarball MUST be compared with the approved candidate before publication is considered complete.

## Compatibility policy

### Existing Nuxt consumers

The monorepo move MUST preserve the `better-convex-nuxt` package name and documented public behavior unless a breaking release explicitly changes it. Internal directory paths and unpublished runtime files are not compatibility contracts.

### Package versions and tags

Public packages use independent versions because their compatibility and security releases have different causes:

```text
better-convex-nuxt@0.x
better-convex-vue@0.x
@better-convex/mcp@0.x
```

The existing Nuxt tag format MAY remain until the release certifier supports reviewed package-qualified tags. New packages use unambiguous package-qualified tags. During beta, internal public-package dependencies use exact versions. Version ranges widen only after an executed compatibility matrix supports them.

Workspace protocols MUST be replaced by exact registry versions before packing. A package MUST NOT publish a `workspace:`, `file:`, or `link:` dependency.

### MCP protocol versions

The MCP package supports only protocol revisions implemented by the pinned official SDK and certified by the release matrix. Supporting a prior revision is desirable when the SDK provides it without a second custom lifecycle. It is not justification for retaining hand-written session or Tasks code.

The release documentation MUST identify:

- latest certified final revision;
- any prior certified revision;
- unsupported optional extensions;
- exact Apps and Tasks extension versions;
- tested clients without implying that untested clients are incompatible.

### Beta and stable status

Authentication or MCP integration that depends on prerelease upstream packages remains beta unless the release process explicitly accepts and documents that risk. Better Convex MUST NOT label a path stable merely because its own API has stopped changing.

### Hard cutovers

Unreleased or beta vNext code uses hard cutovers. It MUST NOT keep:

- old and new client controllers;
- old and new MCP protocol parsers;
- legacy and OAuth public MCP auth on one endpoint indefinitely;
- Ginko custom and Better Convex service-proof paths;
- two review-record sources;
- legacy and replacement Tasks implementations outside an official SDK compatibility layer.

Where user-owned persisted data requires migration, a separate migration plan must define source of truth, rollback, and completion. This RFC does not authorize compatibility state merely as precaution.

## Alternatives considered and rejected

### Put everything in `better-convex-nuxt`

Rejected because plain Vue/Vite applications, Convex-hosted MCP servers, and MCP App views should not install Nuxt, Nitro, H3, or Nuxt auto-import machinery. It would also make future framework boundaries harder to see.

The simpler alternative is separate Vue, Nuxt, and optional MCP packages with private shared source.

### Publish `@better-convex/core` immediately

Rejected because Nuxt and Vue alone do not prove a useful public framework-neutral API. Publishing core would permanently expose low-level lifecycle contracts before a second framework requires them.

The simpler alternative is one private implementation bundled into the public adapters. A future Svelte adapter may justify a public core through a separate RFC.

### Add a catch-all `better-convex` package

Rejected because it would be unclear whether installing it adds Vue, Nuxt, MCP, Better Auth, or server dependencies. The product can be named Better Convex without a meta-package.

### Build one package with runtime detection

Rejected because `if (isNuxt)`, `if (isVite)`, and optional server dependency branches create unclear bundles and lifecycle behavior.

The simpler alternative is explicit framework packages sharing source.

### Add a universal `ConvexPrincipal`

Rejected because combining browser users, MCP subjects, services, and anonymous callers into one public union encourages provenance loss and confused-deputy errors.

The simpler alternative is distinct verified contexts followed by an application-owned actor mapping.

### Add a universal authorization adapter or RBAC system

Rejected because roles, memberships, resource rules, current revocation, and tenant semantics are application data. A generic policy layer would either be too weak or become a second source of truth.

The simpler alternative is a safe verified caller context and ordinary application authorization inside Convex.

### Put roles and permissions in tokens

Rejected because role downgrade and membership removal would remain ineffective until token expiry. Scopes remain coarse delegation ceilings; current authority is loaded from canonical state.

### Publish `@better-convex/trusted-calls`

Rejected because exact internal invocation proof is needed only if Nitro wins the topology proof. Publishing it before that outcome creates a protocol and key-management product without a general requirement.

The simpler alternative is an internal, topology-specific exact-call mechanism. A later public service-call RFC requires multiple non-MCP consumers.

### Publish `@better-convex/commands`

Rejected because standard MCP tools, elicitation, MCP Apps, and Tasks already define the interaction layers. A generic prepare/confirm/execute protocol would duplicate standards and force routine writes through unnecessary state.

The simpler alternative is direct tools for normal writes and application-owned durable review for exceptional high-impact operations.

### Require preview and confirmation for every write

Rejected because host confirmations are not guaranteed, many writes are routine and reversible, and mandatory review records add latency and state without improving backend authorization.

### Rely on host confirmation popups

Rejected because MCP does not prescribe a universal host UI and tool annotations are hints. Hosts may auto-run tools according to their own policies.

The simpler alternative is backend authorization for every operation and authenticated application review when the blast radius requires it.

### Use a resource link as an approval link

Rejected because resource links represent readable context, not navigation consent or secure completion. URL elicitation is the standards-native interaction primitive.

### Use form elicitation for secrets or sensitive authentication

Rejected because form content passes through the MCP client. Passwords, API keys, access tokens, payment credentials, and equivalent secrets use URL mode on the authoritative application.

### Let MCP Apps perform all approvals

Rejected because the iframe is still mediated by the host and a button does not create additional authority. MCP Apps are excellent for previews and ordinary authorized interactions. Application login, step-up authentication, and high-impact final review remain on the authoritative application when required.

### Expose raw Convex functions automatically

Rejected because function kind and generated type information do not define safe tool meaning, descriptions, scopes, risk, result minimization, or public authorization.

### Maintain Convex-native and Nitro-native MCP servers

Rejected because two protocol stacks duplicate conformance, error behavior, capability transitions, and security review. The topology probe exists to choose one.

### Extend the current hand-written MCP parser

Rejected because the current parser intentionally proves a selected `2025-11-25` subset. Extending it across a breaking stateless revision and independent extensions would create a competing MCP implementation.

### Forward the MCP token into Convex after Nitro verification

Rejected as token passthrough and resource-boundary confusion. Nitro uses a separate exact-call proof if it terminates the token.

### Add a mandatory replay table for every call

Rejected because queries and idempotent operations do not need it, while application domains already have different idempotency requirements. Non-idempotent effects use explicit application idempotency or transactional operation records.

### Add a generic review or approval table

Rejected because Ginko and the neutral application already own different canonical review semantics. Better Convex initially projects canonical records as receipts, status, or safe locators; it uses URL elicitation only for a meaningful same-user external interaction.

### Implement legacy Tasks for current compatibility

Rejected because the replacement extension is intentionally not wire-compatible. The official SDK may provide version compatibility; Better Convex will not create a second Tasks engine.

### Enable unauthenticated Dynamic Client Registration by default

Rejected because DCR is optional and expands the public attack surface. Use preregistration or Client ID Metadata Documents where clients support them. Add DCR only through a separately reviewed profile.

### Enable refresh tokens immediately

Rejected because the current bounded access-token profile is compliant and simpler. Refresh requires executed rotation, reuse, revocation, storage, and public-client interoperability evidence.

### Build Ginko-specific compatibility into Better Convex

Rejected because Ginko is a proving consumer, not the product model. Ginko-specific policy and names remain in Ginko, and public extraction requires a neutral second consumer.

## Public API admission test

Before any vNext symbol is exported, its proposal MUST answer:

1. What exact repeated problem does it solve?
2. Can existing official MCP, Convex, Vue, Nuxt, or Better Auth API solve it directly?
3. Can an existing Better Convex path be simplified instead?
4. Which two materially different consumers need it?
5. What source of truth does it read or create?
6. Does it introduce a database table, cache, job, projection, registry, state machine, or key?
7. How is derived state rebuilt or discarded?
8. What invalid states does its type prevent?
9. What security boundary owns authorization?
10. What packed production test proves it?
11. What old code is deleted when it lands?
12. What is the failure and rollback path?

A public API fails admission if its principal justification is future flexibility, symmetry, convenience for one application, or avoiding a short direct call.

## Open decisions with closure gates

These are the only unresolved architectural decisions authorized by this RFC.

### 1. MCP server location

- Preferred: official SDK in Convex HTTP action.
- Alternative: official SDK in Nitro plus internal exact-call proof.
- Closure: Phase 1 hard-gate evidence and accepted topology decision record.
- Prohibited outcome: supporting both as peer public implementations.

### 2. Final `2026-07-28` wire details

- Current input: locked release candidate.
- Closure: re-read final specification, changelog, SDK release notes, and conformance suite after 2026-07-28.
- Prohibited outcome: claiming final compliance from release-candidate behavior.

### 3. Nuxt-to-Vue public integration seam

- Decision: the private source island moves into `better-convex-vue` when publication is approved, and Nuxt consumes the exact package.
- Closure: implementation proof identifies the smallest Vue exports Nuxt needs without importing private source or exposing lifecycle control to ordinary applications.
- Prohibited outcome: a permanent private runtime package, copied Nuxt implementation, or public core package solely for workspace convenience.

### 4. Better Auth MCP adapter location

- Options: optional `@better-convex/mcp` subpath or the existing Nuxt/Convex auth integration.
- Closure: dependency graph and non-Nuxt Better Auth consumer proof.
- Prohibited outcome: Better Auth becoming a required dependency of the provider-neutral MCP base.

### 5. Canonical Vue execution gate

- Options: reactive `enabled` option or one skip sentinel contract.
- Closure: migrate existing Nuxt cases and Ginko adapters, then choose the smaller API.
- Prohibited outcome: preserving multiple equivalent gates indefinitely.

### 6. Neutral second consumer

- Initial choice: agentic SaaS starter.
- Closure: it proves read, ordinary write, and same-subject high-impact handoff after first implementing the domain path directly; shared code must remove measured repeated protocol glue without manufacturing disposable infrastructure.
- Prohibited outcome: stabilizing a Ginko-originated workflow primitive without the neutral proof.

All other deferred ideas require a new RFC or an amendment with named evidence.

## Documentation plan

After implementation, supported documentation must be updated in this order:

1. product introduction and package-selection guide;
2. Vue and Nuxt mental model;
3. authentication and identity provenance;
4. backend authorization;
5. MCP tools and resource-server setup;
6. Better Auth and external authorization-server paths;
7. normal writes, direct same-user URL handoff, and application-owned reviewer queues;
8. MCP Apps with Vue;
9. Tasks, only when shipped;
10. errors, diagnostics, and observability;
11. deployment and security model;
12. release compatibility and exact-artifact certification;
13. migration guide for existing Nuxt and Ginko consumers;
14. complete public API reference.

Docs MUST distinguish normative support from examples and experimental adapters. They MUST name exact supported protocol and extension versions.

## Acceptance criteria

### Product and package shape

- The product and repository are named Better Convex.
- Existing consumers continue installing `better-convex-nuxt`.
- Plain Vue installs `better-convex-vue` without Nuxt or Nitro dependencies.
- Agent integration installs `@better-convex/mcp` only when needed.
- No catch-all package, public core, Commands, Trusted Calls, RBAC, or workflow package exists without a later RFC.
- One private client-lifecycle implementation powers Vue and post-hydration Nuxt behavior.
- One official-SDK-backed MCP protocol implementation remains.

### Vue and Nuxt behavior

- Query, pagination, mutation, action, identity, and disposal invariants pass through the shared implementation.
- Identity changes synchronously retire protected data and stale work.
- SSR remains request-isolated and identity-partitioned.
- Embedded applications receive an opaque runtime rather than tokens.
- Ginko deletes its generic client-lifecycle machinery.
- Exact Vite and Nitro production consumers pass.

### MCP behavior

- The release records and passes the latest final supported MCP revision.
- Tools are explicit, narrow, schema-valid, and backed by canonical application functions.
- Tool annotations are accurate and non-authoritative.
- Structured results and text fallbacks work.
- Protocol and tool execution errors are represented correctly.
- Optional features are negotiated and have safe fallbacks.
- No hand-written supported protocol parser remains when the official SDK supports the runtime.

### Authentication and authorization

- Protected Resource Metadata, discovery, PKCE, exact redirect, resource indicator, issuer, and audience tests pass.
- Better Auth and an external verifier fixture pass.
- Social login, authorization-server, and resource-server roles remain independently enabled.
- Convex session, OAuth access, ID, foreign audience, and malformed tokens are disjoint.
- Token passthrough is absent.
- Scopes remain ceilings and current application authorization runs for every effect.
- Role downgrade, member removal, credential revocation, and tenant boundary changes fail on the next applicable operation.

### High-impact interaction

- Ordinary writes do not require a command or review protocol.
- URL interaction uses the official negotiated MCP mechanism.
- The link is opaque, non-preauthenticated, inert on `GET`, and contains no sensitive data.
- The initiating identity relationship is verified.
- Application reviewer queues record requester and reviewer separately; distinct-human approval is enforced only when the application explicitly owns that policy.
- Current impact and authority are recomputed at execution.
- Stale impact requires fresh review.
- Double confirmation produces one effect and one receipt.
- Lost completion notifications do not affect correctness.
- Ginko reuses its canonical publish review; the neutral consumer proves a different policy.

### MCP Apps

- Vue integration uses the official extension SDK.
- Apps are capability-negotiated progressive enhancement.
- Model-visible launching and accompanying tools retain useful text and structured fallback.
- CSP, sandbox, and permissions are explicit.
- No credential or raw Convex client reaches the iframe.
- App-initiated tool calls receive the same backend authorization.
- High-impact final review remains on the authoritative application when required.

### Tasks acceptance

- No legacy Tasks public API is stabilized.
- The optional replacement extension is implemented only after its gate.
- Application jobs remain canonical.
- Task requests are independently authenticated and authorized.
- No task-list or second workflow source exists.
- Tasks are not a 1.0 prerequisite.

### Errors and privacy

- Public errors remain sanitized.
- Unknown causes remain opaque.
- Error and Nuxt payload serialization contains no raw causes or credentials.
- Safe diagnostics contain only allowlisted mechanical metadata.
- Arguments, tokens, cookies, headers, provider authorization references, review locators, and raw response bodies never enter diagnostics.
- MCP, Vue, and Nuxt production fixtures prove failure behavior from installed packages.

### Release evidence

- Every public package is packed once from a clean final commit.
- Tarball SHA-256, SRI, content manifest, SBOM, dependency tuple, and runtime fingerprint are recorded as applicable.
- Installed bytes match the candidate.
- Nuxt, Vue/Vite, embedded Vue, MCP, URL interaction, and MCP Apps production consumers pass.
- Protected live staging passes before publication.
- The registry tarball matches the approved candidate.
- Ginko records final package commits and artifact hashes in its compatibility record.

## Definition of success

Better Convex vNext succeeds when an application developer can:

```text
1. Build a Nuxt or Vue application on Convex.
2. Select Better Auth or another supported identity provider.
3. Use one proven client lifecycle across Nuxt, Vite, and embedded Vue.
4. Expose a small set of explicit application operations as MCP tools.
5. Receive correct OAuth discovery and exact resource-token validation.
6. Perform ordinary reads and writes without custom command machinery.
7. Route genuinely high-impact operations to a secure authenticated application review.
8. Render rich Vue interfaces in supporting MCP hosts without sharing credentials.
9. Represent long work through the official Tasks extension only when useful.
10. Keep all roles, permissions, policy, workflows, and canonical effects in the application.
11. Diagnose failures through safe structured errors and allowlisted telemetry.
12. Ship the exact package artifacts that passed the complete production evidence matrix.
```

For Ginko specifically, success means:

```text
Ginko keeps CMS policy, contracts, previews, reviews, audit, and canonical mutations.
Ginko deletes generic Vue/Convex lifecycle and custom MCP transport/bridge plumbing.
Ordinary draft writes are ordinary MCP tools.
High-impact publication reuses Ginko's authenticated canonical review queue; optional URL elicitation is same-user and only for meaningful requester interaction.
An optional Vue MCP App presents impact without receiving credentials.
The same Better Convex primitives work in a neutral non-CMS application.
```

## Change control

This RFC is a proposed architecture, not permission to publish every illustrative type or helper.

During implementation:

- completed proof results are added to a linked decision record or evidence ledger;
- a failed hard gate changes the selected implementation, not the invariant;
- any change to package boundaries, authorization ownership, high-impact interaction, or one-topology rule requires an RFC amendment;
- exact API names require implementation review and packed-consumer proof;
- Tasks require explicit activation of Phase 8;
- a future Svelte or public-core proposal requires a separate RFC;
- security findings override roadmap sequencing.

The RFC may move to **Accepted** after the final MCP reconciliation and topology decision. It moves to **Implemented** only when every applicable acceptance criterion has linked evidence and replaced code has been deleted.

## Repository references

Current implementation authorities:

- [Current runtime architecture](../src/ARCHITECTURE.md)
- [Design decisions](../docs/content/docs/2.understand/8.design-decisions.md)
- [Current security model](../docs/content/docs/7.operations/3.security-model.md)
- [Delegated OAuth and MCP](../docs/content/docs/4.build/3.authentication/10.delegated-oauth-and-mcp.md)
- [Server Convex calls](../docs/content/docs/4.build/4.server/1.server-convex.md)
- [Error types](../docs/content/docs/6.reference/4.error-types.md)
- [Release compatibility](../docs/content/docs/7.operations/5.release-compatibility.md)
- [Delegated-human MCP starter](../starters/mcp-oauth-agent/README.md)
- [Convex MCP route](../starters/mcp-oauth-agent/convex/http.ts)
- [Application MCP registration](../starters/mcp-oauth-agent/convex/mcp.ts)
- [MCP handler boundary](../packages/mcp/src/handler.ts)
- [MCP transport bounds](../packages/mcp/src/transport.ts)
- [Current selected MCP conformance runner](../scripts/run-mcp-conformance.mjs)
- [Release packer](../scripts/release.mjs)
- [Release verifier](../scripts/verify-release.mjs)
- [Vue API restraint precedent](./RFC-useConvexForm.md)

## External references

All web references were checked on 2026-07-20. Final implementation must re-check versioned and living documents at its release date.

### Model Context Protocol

- [MCP `2025-11-25` specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP `2025-11-25` changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [MCP versioning](https://modelcontextprotocol.io/docs/learn/versioning)
- [MCP architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [MCP elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Legacy experimental Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP `2026-07-28` release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP extensions overview](https://modelcontextprotocol.io/extensions/overview)
- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [MCP Apps SDK documentation](https://apps.extensions.modelcontextprotocol.io/)
- [Tasks extension overview](https://modelcontextprotocol.io/extensions/tasks/overview)
- [SEP-2663 Tasks Extension](https://modelcontextprotocol.io/seps/2663-tasks-extension)
- [OAuth Client Credentials extension](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Official MCP conformance project](https://github.com/modelcontextprotocol/conformance)

### Better Auth

- [Better Auth social OAuth](https://better-auth.com/docs/concepts/oauth)
- [Better Auth OAuth 2.1 Provider](https://better-auth.com/docs/plugins/oauth-provider)

### Convex

- [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)
- [Convex authentication](https://docs.convex.dev/auth)
- [Convex Vue client overview](https://docs.convex.dev/client/vue/overview)
- [Convex mutations](https://docs.convex.dev/functions/mutation-functions)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex components](https://docs.convex.dev/components/using)

### Vue

- [Vue composables](https://vuejs.org/guide/reusability/composables.html)
- [Vue plugins](https://vuejs.org/guide/reusability/plugins.html)
- [Vue provide/inject](https://vuejs.org/guide/components/provide-inject.html)

## Decision

Adopt Better Convex as a Vue-first product family with optional, official-SDK-backed MCP integration.

The final governing model is:

```text
Authentication
  Better Auth or another provider verifies the relevant credential provenance.

MCP
  The official protocol transports explicit tools, resources, interactions, Apps, and optional Tasks.

Better Convex
  Preserves identity boundaries, supplies framework lifecycle, and safely connects MCP to Convex.

Authorization
  The application resolves current actors, tenants, resources, memberships, and permissions.

Execution
  Convex revalidates and applies canonical local effects transactionally.

Presentation
  Vue, Nuxt, MCP hosts, MCP Apps, and authenticated review pages present the same application truth through their appropriate boundaries.
```

The architecture succeeds by making the standards path easy and the unsafe path difficult, while refusing to own application policy that Better Convex cannot know.
