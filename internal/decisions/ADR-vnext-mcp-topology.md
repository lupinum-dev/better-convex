# ADR: provisional vNext MCP topology

- Status: accepted for experimental implementation
- Date: 2026-07-22
- Decision: Convex-native
- Stabilization gate: `G-001`
- Nitro restoration commit: `988b40f1`
- Nitro restoration branch: `codex/archive-mcp-nitro-beta5`

## Decision

Build the experimental `better-convex-mcp` package on the Convex-native topology. The official MCP
server SDK terminates MCP and OAuth bearer access in one explicit Convex HTTP action. That action maps
each registered tool or resource to one named internal application operation. Application state and
authorization remain canonical in Convex.

This is an implementation decision, not a final-spec compliance claim. The package remains prerelease
until the published `2026-07-28` specification, corresponding final SDK, official conformance suite,
real hosts, and production operational evidence close `G-001`.

## Why this is the smaller system

Both candidates passed the private security and protocol laboratory. Convex-native wins the provisional
product decision because it has:

- one deployment and one availability boundary;
- no internal signing credential, key rotation, canonical argument proof, or second timeout budget;
- one bearer-consuming `/mcp` route, with bearer and provider metadata absent from application
  operations;
- application authorization and effects in the same canonical backend;
- official SDK execution in the deployed Convex runtime without a parser fork, Node polyfill, or patch;
- no dependency on Nuxt, Nitro, H3, or Better Auth in the provider-neutral base.

Nitro's repeatable local warm-read result was faster, but the sample was loopback-only. It does not
justify owning a second runtime and a second security protocol before production evidence establishes a
material user requirement.

## Security boundary

The selected path is:

```text
MCP client
  -> official SDK in one Convex HTTP action
  -> provider-neutral bearer verifier
  -> allowlisted access context and scope ceiling
  -> one explicit internal application operation
  -> live application-owned authorization
  -> canonical state/effect
```

Bearer credentials, provider authorization references, and SDK `AuthInfo` terminate at the HTTP action.
They are never forwarded as ordinary Convex function arguments. OAuth scopes are ceilings, not current
application authority. Every effect reloads current application authorization.

## Nitro restoration capsule

The complete beta.5 fallback is frozen at commit `988b40f1` on
`codex/archive-mcp-nitro-beta5`. The branch contains the production Nitro server, OAuth edge, exact-call
signer/verifier, canonical Convex encoding, fixed query/mutation/action wrappers, deployed fixture,
concurrency and redaction tests, Apps adapter proof, operational comparison, and reproduction commands.

Primary implementation paths:

- `internal/labs/mcp-topology/nitro/notes-handler.ts`;
- `internal/labs/mcp-topology/nitro/fixture/**`;
- `internal/labs/mcp-topology/nitro/exact-call/**`;
- `test/unit/vnext-mcp-nitro-probe.test.ts`;
- `test/unit/vnext-exact-call-proof.test.ts`;
- `test/unit/vnext-mcp-exact-call-client.test.ts`;
- the Nitro half of `test/unit/vnext-mcp-apps-probe.test.ts`.

Primary evidence:

- `internal/evidence/mcp-nitro-probe-2026-07-20.md`;
- `internal/evidence/mcp-nitro-exact-call-2026-07-21.md`;
- `internal/evidence/mcp-nitro-integrated-path-2026-07-22.md`;
- `internal/evidence/mcp-runtime-purity-2026-07-20.md`;
- `internal/evidence/mcp-topology-conformance-2026-07-20.md`;
- `internal/evidence/mcp-http-adversarial-2026-07-20.md`;
- `internal/evidence/mcp-oauth-resource-lab-2026-07-20.md`;
- `internal/evidence/mcp-apps-probe-2026-07-21.md`;
- `internal/evidence/mcp-sdk-beta5-reconciliation-2026-07-22.md`.

To reproduce the archived fallback, create a detached worktree at `988b40f1`, use the exact lockfile,
and run the commands in the integrated-path evidence. Do not merge the archive branch back or maintain
feature parity. If the decision is reopened, port the smallest still-relevant proof into a new branch
and re-run it against the then-current final protocol and SDK.

## Reversal triggers

Reopen `G-001` only with evidence that changes the product decision, for example:

- the final official SDK cannot execute in the supported Convex runtime without a protocol fork;
- Convex HTTP actions cannot satisfy a mandatory final transport, streaming, connection, or extension
  requirement;
- supported hosts require a connection/session behavior that the selected deployment cannot provide;
- measured production latency, timeout, isolation, or recovery makes the single-runtime path unfit for
  the target workload;
- a provider-neutral authorization-server integration requires an edge capability unavailable in
  Convex;
- a material security defect exists in the selected boundary and Nitro avoids the root cause rather
  than merely relocating it.

Preference, framework familiarity, local loopback latency, or speculative future flexibility are not
reversal evidence.

## Deletion obligation

The archive is the durable fallback; the active tree must not retain a peer Nitro topology. After the
Convex-native package replaces the shared laboratory coverage, delete the active Nitro paths listed
above, remove Nitro-only dependencies/configuration, and retarget Apps and conformance proof to the
selected package. Preserve the ADR and non-secret evidence; they explain the decision without keeping a
second implementation alive.
