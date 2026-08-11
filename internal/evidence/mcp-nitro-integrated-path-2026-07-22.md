# Nitro integrated MCP-to-Convex path — 2026-07-22

## Scope

This closes private laboratory task `P1-020`. It proves Candidate B as one production request path:

```text
official MCP client
  → production Nitro `/api/mcp`
  → provider-neutral OAuth verification
  → request-bound MCP actor and scopes
  → short-lived Ed25519 exact-call proof
  → one fixed Convex HTTP route
  → one fixed internal query/mutation/action
  → current application authorization and canonical state
```

It does not select Nitro, publish a Trusted Calls API, or turn the proof into a general service-call
protocol. The final MCP specification, real hosts, cloud deployment, and topology decision remain open.

## Gap that required this work

The previous evidence proved the production Nitro MCP edge against a synchronous in-process notes
application and proved the signed Convex hop in a separate fixture. Those halves did not prove their
composition. They also could not support an honest latency or failure-recovery comparison with the
Convex-native candidate.

The hard cut made the private Nitro handler accept one request-bound `NeutralNotesOperations` facade.
The production fixture now uses only the signed Convex facade. The in-process application remains only
in focused handler unit tests; it is no longer Candidate B's production topology evidence.

The exact-call Convex fixture was aligned with all five canonical neutral operations:

- `search_notes` query;
- `note://<id>` resource read;
- idempotent `rename_note` mutation;
- immediate, side-effect-free `generate_report` action;
- revision-bound `delete_workspace` mutation.

The artificial `reportReceipts` table and action request key were deleted. The report has no side effect,
so a replay record was a second source of truth with no invariant to protect.

## Security and behavior proved

The production Nitro and freshly deployed Convex pair executed:

- Alice and Bob concurrently through separate official SDK clients;
- same-tenant reads and cross-tenant denial;
- note resource reads through a fixed signed query route;
- idempotent rename and replay with one canonical receipt;
- bounded report action results;
- owner-only, revision-bound workspace deletion;
- live member removal denying the next already-authenticated operation;
- sixteen concurrent reads without identity crossover;
- a read-only OAuth token that can search but receives `ACCESS_DENIED` for writes;
- exact operation/function/arguments/issuer/resource/client/scopes inside every signed proof;
- a stopped Convex backend becoming the coarse MCP result `OPERATION_FAILED`;
- no bearer, private JWK, proof, call ID, authorization reference, provider metadata, or raw failure in
  MCP responses or browser output.

The same read-only scope-ceiling test was added to Candidate A. This found and closed a laboratory gap:
both candidates previously required `notes:read` at ingress but allowed application role checks alone to
decide write tools. Scopes now remain ceilings while current database membership/role remains the grant.

The first integrated run also found a real asynchronous seam defect: the Nitro search handler placed a
`Promise` inside `structuredContent.matches`. The official SDK rejected the output schema. Awaiting the
request-bound application call fixed it; sync-only tests could not have detected this.

## Bounded internal hop

The private fallback uses:

- a dedicated Ed25519 key pair, with the private key only in the Nitro process environment and the
  public key only in Convex deployment configuration;
- a 15-second proof with an exact allowlisted header and claim set;
- canonical `convexToJson` arguments plus a SHA-256 digest;
- a fixed route, operation kind, generated function name, deployment audience, service ID, OAuth issuer,
  subject, client, resource, and sorted scopes;
- a 16 KiB Convex request bound, 64 KiB Nitro response bound, one-second Convex body deadline, and
  five-second Nitro upstream deadline;
- HTTPS resources in normal evidence and HTTP only for exact loopback hostnames in local deployment
  evidence.

The internal proof authenticates one invocation. Application idempotency owns write replay. The neutral
report is read-only; a future external effect would need application-owned intent, provider idempotency,
and reconciliation rather than a generic proof replay table.

## Preliminary local operational comparison

Twenty sequential `search_notes` calls were measured after warm-up on the same machine. These are
loopback development measurements, not production acceptance thresholds:

| Candidate                   |                        Run |   Median |      p95 |   Maximum |
| --------------------------- | -------------------------: | -------: | -------: | --------: |
| Nitro → exact-call → Convex |                   isolated | 10.13 ms | 12.60 ms |  12.74 ms |
| Convex-native MCP action    |                   isolated | 51.12 ms | 86.76 ms | 115.28 ms |
| Nitro → exact-call → Convex | parallel official-tool run | 11.46 ms | 15.65 ms |  17.11 ms |
| Convex-native MCP action    | parallel official-tool run | 59.82 ms | 98.20 ms | 137.35 ms |

The result is directionally repeatable but does not select Candidate B. Candidate A still has one
deployment and no internal signing-key lifecycle. Candidate B currently has lower local latency but owns
two runtimes, an extra availability boundary, key rotation, exact route wrappers, canonical encoding,
and a second timeout budget. `P1-017` remains pending until final SDK, cloud, and real-host measurements.

## Reproduction

```sh
pnpm exec vitest run --config internal/labs/mcp-topology/nitro/exact-call/vitest.config.ts --reporter=verbose
pnpm exec vitest run --config internal/labs/mcp-topology/nitro/vitest.config.ts --reporter=verbose
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
BCN_VNEXT_MCP_OFFICIAL_TOOLS=true pnpm exec vitest run \
  --config internal/labs/mcp-topology/nitro/vitest.config.ts --reporter=verbose
BCN_VNEXT_MCP_OFFICIAL_TOOLS=true pnpm exec vitest run \
  --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
pnpm exec vitest run test/unit/vnext-exact-call-proof.test.ts \
  test/unit/vnext-mcp-exact-call-client.test.ts test/unit/vnext-mcp-nitro-probe.test.ts \
  test/unit/vnext-mcp-apps-probe.test.ts
pnpm exec vue-tsc --noEmit
```

Both ordinary and official-tool production runs passed. The official Inspector and current-final
conformance matrix therefore exercise Candidate B's actual signed Convex path rather than its former
in-process substitute.
