# MCP official tooling preflight — 2026-07-22

## Scope

This is pre-entry evidence for `P1-016`, not completion of that task and not a public protocol support
claim. It proves that both private production topology candidates can be exercised by the latest
published official Inspector and conformance packages available from npm on 2026-07-22. The final
`2026-07-28` protocol/SDK reconciliation and compatible real-host matrix remain mandatory.

Primary authorities checked:

- [official conformance repository](https://github.com/modelcontextprotocol/conformance);
- [official Inspector repository](https://github.com/modelcontextprotocol/inspector);
- [official Inspector documentation](https://modelcontextprotocol.io/docs/tools/inspector);
- npm registry metadata for the exact packages below.

## Exact published tools

```text
@modelcontextprotocol/conformance@0.1.16
@modelcontextprotocol/inspector@1.0.0
```

The versions are constants in the private lab harness. They are invoked with `pnpm dlx` and are not
added to a public package or production dependency graph. The current conformance package advertises
`2025-11-25` server scenarios; this run explicitly selects that latest final revision. The topology
servers still use exact private SDK v2 beta bytes, so this proves compatibility behavior only—it does
not relabel prerelease SDK behavior as final.

## Harness boundary

`internal/labs/mcp-topology/official-tools.ts` is imported by both existing independent topology tests.
It does not construct an MCP server, parse protocol messages, define tools/resources, or abstract the
two candidates.

Inspector supports explicit HTTP headers, so it connects directly to each candidate with the static,
non-secret lab bearer. The conformance CLI has no header option. For those four scenarios only, the
harness creates a bounded loopback relay that:

- accepts only the exact candidate pathname/query;
- caps request bodies at 1 MiB and upstream responses at 2 MiB;
- strips caller authorization, host, connection, and transfer-encoding headers;
- adds the static lab bearer and forwards to the already-running candidate;
- follows no redirects and uses a ten-second upstream deadline;
- owns no protocol behavior and is closed after every run.

The relay is evidence plumbing, not a topology candidate or product path. All result directories and
the relay are temporary. The harness rejects any official-tool output containing the lab bearer.

## Executed matrix

Inspector operations, directly against each candidate:

```text
tools/list
tools/call search_notes(workspaceId=workspace-a, query=alpha)
resources/templates/list
resources/read note://note-a
```

The harness requires the expected tool, result, resource template, and note content in Inspector's
output.

Official conformance scenarios, through the bounded auth relay:

```text
server-initialize
ping
tools-list
resources-list
```

Each scenario runs separately with `--spec-version 2025-11-25`; the command must exit successfully and
write at least one official `checks.json` record. There is no expected-failure baseline.

## Reproduction

```text
npm view @modelcontextprotocol/conformance version dist.tarball --json
npm view @modelcontextprotocol/inspector version dist.tarball --json
pnpm dlx @modelcontextprotocol/conformance@0.1.16 list --server
BCN_VNEXT_MCP_OFFICIAL_TOOLS=true pnpm exec vitest run \
  --config internal/labs/mcp-topology/nitro/vitest.config.ts --reporter=verbose
BCN_VNEXT_MCP_OFFICIAL_TOOLS=true pnpm exec vitest run \
  --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
```

Results:

- Nitro-native: one production build/runtime test passed in 11.97 seconds (12.24-second suite duration);
- Convex-native: one deployed local Convex test passed in 14.35 seconds (15.00-second suite duration,
  including deployment setup/teardown);
- all eight official-tool checks passed for each candidate;
- no expected failures, SDK patch, protocol fork, public dependency, or bearer output was introduced.

The first Inspector preflight correctly failed because `resources/list` lists concrete resources, while
the neutral note surface is a resource template. The harness now uses the official
`resources/templates/list` method and separately proves `resources/read`. This is retained as evidence
that Inspector semantics, rather than an assumed combined resource list, drive the integration.

## Remaining `P1-016` gates

- reconcile the actually published `2026-07-28` specification and final SDK;
- rerun the final official conformance suite rather than this bounded current-final subset;
- exercise compatible real hosts with recorded versions and deployment hashes;
- prove host-specific tool/resource/Apps/interaction behavior and safe logs;
- retain only evidence applicable to the selected topology after `G-001` is accepted.

Neither topology wins from this slice: both remain compatible with the official developer tooling under
the tested current-final scenarios.
