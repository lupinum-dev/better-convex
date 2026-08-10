# Neutral second-consumer interaction proof — 2026-07-24

## Outcome

The neutral notes workspace is the correct non-CMS proving consumer for the shared MCP, interaction,
and Vue MCP App primitives. It passes the RFC's materially-different-consumer gate without adding
another public API or copying Ginko's reviewer workflow.

The older `internal/labs/agentic-saas` application is deliberately not used for this gate. It has no
real provider-backed execution path and already models an application reviewer queue, which is too
similar to Ginko's policy to prove the direct same-user interaction composition. Adding MCP transport
to that mock-only laboratory would create code without new product evidence.

## Materially different policies

| Concern                        | Neutral notes workspace                                                                                         | Ginko CMS                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Domain                         | Workspace notes                                                                                                 | Editorial content and publishing                                                                                                     |
| Read                           | Search notes visible to the current workspace actor                                                             | Read CMS contract/content under current integration and member authority                                                             |
| Ordinary write                 | Rename one note immediately when currently authorized                                                           | Explicit bounded content operation under current contract/member authority                                                           |
| High-impact operation          | Workspace owner personally deletes the workspace through same-issuer/subject interaction                        | A canonical application review is created; any currently authorized publisher may decide under Ginko policy                          |
| Canonical record               | `workspaceDeletionInteractions`                                                                                 | Existing Ginko publish-review row                                                                                                    |
| Browser identity               | Must equal the initiating issuer and subject                                                                    | Reviewer authenticates under their own current application identity                                                                  |
| Unsupported interaction client | Creates no deletion interaction and receives `interaction_unsupported`                                          | Ordinary review creation may still return its inert application queue locator because the review row is already the canonical effect |
| Final effect                   | Interaction consumption, current authority/impact check, workspace deletion, and receipt in one Convex mutation | Current reviewer authority/impact check, review decision, publication, and receipt in one Ginko transaction                          |
| App                            | Notes search/rename dashboard                                                                                   | Publish-impact preview; final review stays in authenticated Studio                                                                   |

The different policies prove that Better Convex supplies transport, access provenance, lifecycle, safe
interaction projection, and iframe boundaries—not an approval model. Neither consumer imports the
other's state, roles, effects, or status transitions.

## Shared primitives and single owners

The neutral consumer uses:

- `handleMcpRequest()` for the one bearer-consuming official-SDK HTTP action;
- `runMcpTool()` for allowlisted operation diagnostics and opaque unexpected failures;
- direct official-SDK tool/resource registration and schemas;
- `useMcpApp()` for Vue mount, readonly cloned projections, host calls, and disposal;
- one application-owned interaction table for current authority, impact, expiry, replay, effect, and
  receipt;
- one private locked-RC adapter in the fixture for `InputRequiredResult` and request-state mapping.

The RC adapter is not exported from `@better-convex/mcp`, `better-convex-vue`, or
`better-convex-nuxt`. The application core imports no MCP protocol type. Final publication can
therefore replace only the narrow adapter without migrating application state or authorization.

The Ginko consumer uses the same public transport and Vue lifecycle primitives, but projects its
existing review row. It has no copy of `workspaceDeletionInteractions`, the notes policy, or the private
RC adapter.

## Executed behavior

Focused source proof:

```text
pnpm exec vitest run --project=unit \
  test/unit/vnext-neutral-notes.test.ts \
  test/unit/mcp-operation-mapping.test.ts \
  test/unit/vnext-mcp-apps-probe.test.ts --reporter=dot
```

Result: three files and six tests passed. These cover the neutral canonical application, explicit
read/write mapping, App fallback and host behavior, validated operation projection, and absence of
implicit function exposure.

The deployed and exact-package evidence is already stronger than this focused crosswalk:

- `internal/evidence/phase6-interaction-adversarial-disclosure-2026-07-24.md` proves current grant,
  issuer/subject/client/resource binding, wrong-user, stale impact, expiry, replay, concurrency, one
  effect/receipt, status recovery, and disclosure negatives;
- `internal/evidence/phase6-exact-interaction-lifecycle-2026-07-24.md` proves the same lifecycle through
  exact Vue beta 18, Nuxt beta 18, MCP beta 6, and Ginko candidate bytes;
- `internal/evidence/neutral-mcp-app-example-2026-07-22.md` and
  `internal/evidence/mcp-app-conformance-matrix-2026-07-22.md` prove the production notes dashboard and
  its Ginko policy contrast;
- `internal/evidence/mcp-explicit-operation-mapping-2026-07-22.md` proves each tool/resource maps to one explicit
  application operation and that unknown or cross-resource calls fail closed.

## Measured simplification

The two-consumer result reduced maintained glue rather than creating a generic workflow layer:

- the Better Convex MCP topology hard cut deleted 18,650 lines of relay, hand-written parser, duplicate
  starter, and peer topology evidence from the active tree;
- Ginko's one-endpoint MCP hard cut deleted 5,707 lines while adding 823 lines of canonical Convex-native
  integration and tests;
- Ginko's Vue lifecycle hard cut deleted a net 867 lines by replacing its subscription, pagination,
  callable, and identity engines with the shared Vue runtime;
- the later public API hard cut deleted 126 lines while adding 74 and removed unadmitted helper exports;
- this neutral-consumer closure adds no runtime code, table, option, compatibility shim, tool registry,
  authorization DSL, or public export.

Line counts are descriptive evidence, not acceptance budgets. The invariant is that only one lifecycle
engine, one official-SDK MCP server topology, and application-owned state remain.

## API admission result

No new public API is admitted by this task. The existing MCP handler/verifier seam and Vue App lifecycle
already solve the repeated infrastructure problem for two materially different consumers. The
interaction mapping remains private until the final MCP specification and SDK are published and
reconciled.

This also rejects promoting the mock-provider Agentic SaaS laboratory to a maintained starter merely to
satisfy a roadmap label. Its existing internal status remains correct until a real provider path,
production deployment, and exact-package proof exist.
