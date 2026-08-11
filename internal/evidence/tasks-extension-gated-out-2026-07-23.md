# MCP Tasks extension remains gated out — 2026-07-23

## Decision

Better Convex 1.0 ships no Tasks product, adapter, state, export, or compatibility layer. Phase 8 remains
blocked and does not block the rest of 1.0 stabilization.

This is a positive admission decision, not deferred half-implementation:

- the replacement `io.modelcontextprotocol/tasks` design is still documented from the experimental
  extension repository;
- the pinned official SDK exposes Tasks through an explicitly experimental surface that may change;
- two relevant compatible production hosts have not been proven;
- neither the neutral consumer nor Ginko has demonstrated a deferred canonical application job for
  which a normal structured status result is insufficient.

The old `2025-11-25` Tasks protocol is intentionally not retained. Better Convex will not create
`tasks/list`, a second job database, a generic job state machine, or a compatibility translation layer.

## Primary-source checkpoint

Checked on 2026-07-23:

- [official Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview) identifies the
  feature as an extension and points to `experimental-ext-tasks` for its specification;
- [official TypeScript SDK server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md#tasks-experimental)
  labels the Tasks API experimental;
- [2026-07-28 release-candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
  confirms that the old core feature is replaced by the new extension and that `tasks/list` is removed;
- [SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension) defines the intended
  `tasks/get`, `tasks/update`, and `tasks/cancel` model, but a Final SEP alone does not satisfy BCN's
  SDK, client, and consumer entry gates.

Final MCP core reconciliation remains separately blocked until the scheduled 2026-07-28 publication.

## Repository proof

- `@better-convex/mcp` has exactly two runtime exports:
  `handleMcpRequest` and `runMcpTool`.
- Its only named types are the provider-neutral access-verifier contract.
- Vue, Nuxt, and MCP package-entry manifests contain no public name matching `task`.
- Runtime source contains no Tasks adapter, task store, task route, task registration, or legacy parser.
- Documentation says Tasks are unsupported and directs applications with unsupported requirements to
  use their own application boundary rather than implying a partial protocol.

The package-entry regression test checks all three public packages so a Task-named export cannot appear
without an explicit manifest and evidence change.

## Re-entry conditions

Phase 8 may be reconsidered only when all `P8-001` conditions are evidenced together:

1. the final extension and selected official SDK surface are stable enough to pin;
2. at least two relevant clients negotiate and exercise it;
3. a real consumer has one canonical deferred application job;
4. a structured immediate/status tool result is demonstrably insufficient.

If those conditions later pass, Better Convex may project the existing application job. It still must
not own canonical job state or add enumeration.
