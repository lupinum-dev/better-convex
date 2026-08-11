# MCP App disclosure-surface scan — 2026-07-22

## Outcome

Unique sentinels for every forbidden iframe category are absent from inspected
neutral and Ginko App surfaces:

- host cookie/session value;
- MCP bearer token;
- Convex browser JWT;
- internal service proof;
- provider authorization reference;
- raw upstream cause;
- unrestricted raw Convex client.

The neutral proof places a real HTTP-only cookie sentinel at the outer host
boundary and uses the bearer sentinel in the real MCP transport. Ginko uses its
bearer in the real MCP request and keeps the remaining unique values as
non-enumerable outer-host-only state. The proofs first verify those boundary
values exist; absence therefore cannot pass because the fixture forgot to
create the sentinel class.

## Scanned surfaces

The production-browser tests inspect:

- minified App HTML and production module graph;
- served `ui://` resource bytes and metadata;
- iframe DOM after malicious and valid results;
- both-direction official AppBridge messages, including teardown;
- app-originated tool request bodies;
- structured and text MCP results;
- browser console text and serialized arguments;
- page errors and failed request URLs;
- application diagnostics captured by the proof;
- forbidden dependency/module IDs and direct-navigation strings in bundles.

The iframe has no direct network route (`connect-src 'none'`). Browser capture
also proves no unexpected request, console error, page error, executable result
payload, direct `window.open`, or unapproved tool crosses the boundary.

Ginko's `agentRunId` is intentionally not classified as a provider
authorization reference. It is an application-owned identifier already present
in the canonical MCP tool input; it is neither secret nor sufficient for
authority. Current bearer, credential, run, membership, role, resource, and
contract checks remain mandatory on the server for every refresh.

## Evidence

- Neutral: `test/unit/vnext-mcp-apps-probe.test.ts` and
  `internal/labs/mcp-topology/apps/notes-dashboard/browser-proof.ts`.
- Ginko: branch `codex/better-convex-mcp-apps`, commit `7babc915`,
  `test/runtime/mcp-publish-impact-app.test.ts`.
- Shared Vue boundary: exact `@modelcontextprotocol/ext-apps@1.7.4`,
  `allowUnsafeEval: false`, `strict: true`, readonly cloned projections, and
  exact-once scope cleanup.

This is source/production-bundle evidence. Exact installed-tarball scanning is
owned by `P7-013`; this report does not substitute for it.
