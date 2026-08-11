# MCP high-impact interaction locked-RC proof — 2026-07-24

## Outcome

Commit `cfc2a020` proves the difficult application-owned portion of a high-impact MCP interaction
without admitting an RC protocol surface into a public package.

The neutral notes application now owns one bounded workspace-deletion operation record. Its Convex
transaction boundary owns:

- the initiating issuer, subject, client, resource, operation key, target, and opaque locator;
- the workspace revision and exact bounded impact captured at preparation;
- expiry and terminal `pending`, `applied`, `stale`, or `expired` state;
- current application authority and current impact revalidation;
- the canonical deletion effect, one record consumption, and one receipt.

The locked `@modelcontextprotocol/server@2.0.0-beta.5` adapter exists only in the private Convex-native
topology laboratory. It translates the application result to the RC `input_required` result when the
client advertises URL elicitation. The RC result never grants authority: accepting it in a host without
confirming in the application leaves the operation pending and changes no application state.

No interaction API, type, helper, storage shape, or RC vocabulary was added under `packages/`, `src/`,
the root package manifest, or a public export.

## Application invariants proved

The deployed Convex probe executed these cases against real mutations:

1. An owner can prepare a bounded workspace-deletion operation.
2. A client without URL-elicitation capability receives a truthful `interaction_unsupported` result
   before an operation record is created.
3. The URL uses the fixed origin `https://notes.example.invalid` and an opaque random locator.
4. The operation key is explicit caller state; forged or mismatched `requestState` is rejected.
5. Host acceptance without application confirmation returns `pending`, creates no second operation,
   and performs no deletion.
6. Current application role is observed at execution; a newly promoted owner can confirm.
7. Wrong issuer, subject, or client and a removed member cannot read or execute the operation.
8. A note added after preparation changes the captured impact and makes the operation terminally
   `stale`.
9. Expired operations become terminally `expired`.
10. Two synchronized confirmations produce one canonical effect and the same receipt.
11. Replaying or recovering an applied operation returns the stored receipt without repeating the
    effect.
12. Bearer-token sentinels are absent from MCP results.

The active-note impact query uses a bounded `take(101)` and rejects a workspace with more than 100
active notes instead of creating an unbounded operation. Convex optimistic concurrency control protects
the record read, canonical writes, record consumption, and receipt as one mutation.

## Executed evidence

```text
pnpm typecheck

pnpm exec eslint \
  internal/labs/mcp-topology/conformance-vectors.ts \
  internal/labs/mcp-topology/convex/fixture/convex/fixture.ts \
  internal/labs/mcp-topology/convex/fixture/convex/mcp.ts \
  internal/labs/mcp-topology/convex/fixture/convex/operations.ts \
  internal/labs/mcp-topology/convex/fixture/convex/schema.ts \
  internal/labs/mcp-topology/convex/probe.test.ts

pnpm exec vitest run \
  --config internal/labs/mcp-topology/convex/vitest.config.ts
```

Typechecking and focused lint passed. The deployed local Convex probe passed both tests, including the
official beta.5 client/server URL-elicitation round trip and the application-owned interaction,
authorization, stale, expiry, concurrency, replay, recovery, and disclosure matrix.

The public-boundary scan returned no RC interaction match:

```text
rg -n \
  "InputRequiredResult|inputRequired|elicitUrl|requestState|workspaceDeletionInteractions|prepareWorkspaceDeletion" \
  packages src test package.json pnpm-lock.yaml
```

## Remaining Phase 6 proof

This proof deliberately does not treat an MCP host response as human authorization and does not claim
that a URL itself is a capability. Before public API admission, Phase 6 still needs:

1. a production page adapter whose `GET` is inert and whose explicit state-changing request requires
   the initiating authenticated issuer and subject;
2. browser evidence for prefetch, crawler, forwarded-link, wrong-user, expiry, stale, replay,
   concurrency, lost-response recovery, cache, frame, and referrer behavior;
3. sentinel scans across HTML, logs, diagnostics, results, and exact packed bytes;
4. projection onto Ginko's existing canonical review records without a second approval source; and
5. reconciliation with the actually published `2026-07-28` specification, SDK, changelog, and
   conformance tools before any public interaction API or final compliance claim.
