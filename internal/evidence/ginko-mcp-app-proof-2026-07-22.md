# Ginko publish-impact MCP App proof — 2026-07-22

## Outcome

Ginko CMS branch `codex/better-convex-mcp-apps` is pushed at commit
`7babc915` (implementation commit `3368af0e`). It proves that the shared Vue MCP App lifecycle can present a real
application-owned publish preview without moving publish or review authority
into Better Convex or the iframe.

The slice adds one explicit `preview-publish` tool backed by Ginko's existing
`mcpPreviewPublishEntry` mutation and one optional `ui://` publish-impact
resource. The App renders the canonical Ginko preview contract:

- `allowed`, summary, blockers, and warnings;
- effect `kind`, `summary`, exact/bounded count fields;
- the explicit `publicChanged: false` result of the preview path.

The App can refresh the same preview through the official host bridge. Its
only navigation action is a host-mediated link to authenticated Studio. The
host denies that link in the proof to demonstrate that `ui/open-link` is a
presentation capability, not approval or application authority.

## Authority boundary

The implementation deliberately does not register or embed:

- publish, approve, confirmation, or review-creation tools;
- a second review/approval record;
- a raw Convex client;
- bearer/session tokens or provider authorization state;
- direct iframe navigation.

The MCP bearer is resolved outside the iframe. Current Ginko credential scope,
active agent run, CMS caller, contract binding, membership, role, resource,
and publish-impact state are rechecked by the existing application path. The
App receives ordinary application arguments and the sanitized structured tool
result; the `agentRunId` is an application identifier, not a bearer credential
and grants no authority by itself.

The tool remains useful without Apps support: its exact text and structured
fallback is returned through ordinary MCP. Supplying App HTML adds metadata
and the `ui://` resource only; it does not create a second tool or change the
tool's authorization.

## Executed evidence

On Ginko implementation commit `3368af0e`, with the disclosure scan strengthened
at `7babc915`:

- full Vitest suite: 188 files passed, one skipped; 1,247 tests passed, one
  skipped;
- focused MCP/App/package-boundary suite: 3 files and 24 tests passed;
- production Vite App and official AppBridge browser execution passed;
- repository formatting passed across 1,206 files;
- ESLint across `packages` and `test` passed with zero warnings;
- contract, Convex package, Convex type-test, and Studio Vue typechecks passed;
- generated setup/template provenance, publish specifier, live MCP token, and
  diff checks passed.

The browser proof covers canonical preview rendering, host-only refresh,
allowlisted tool execution, host-denied navigation, exact fallback, resource
metadata, App teardown, console/page error absence, document size bounds, and
bearer/raw-client sentinel absence from bridge messages and bundled HTML.

## Proof scope and deletion boundary

This is source-level second-consumer evidence, not final package
certification. The Ginko test builder intentionally points at the BCN working
tree and its exact Apps SDK while the package remains unreleased. `P7-013`
must replace that development-only binding with immutable tarballs, lockfile
references, installed-byte equality, and production host/fallback consumers.

The fixture host is a test harness, not a second product runtime. It may remain
only while it supplies materially different Ginko evidence; common bridge,
security, and sentinel coverage must converge into the Phase 7 shared matrix
under `P7-011`/`P7-012`, after which duplicated low-level harness code is
deleted.
