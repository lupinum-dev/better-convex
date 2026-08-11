# MCP ecosystem checkpoint — 2026-07-20

Checked at `2026-07-20T10:49:41Z`. This is a time-bounded implementation checkpoint, not a
permanent compatibility claim. Primary project sources and the public npm registry were used; no
search-result summary is treated as authority.

## Decision summary

- The current, production-ready MCP protocol revision is **`2025-11-25`**.
- MCP **`2026-07-28` is a locked release candidate**, scheduled to become final on 2026-07-28. It
  must not be described as final before then.
- The supported production TypeScript SDK remains **`@modelcontextprotocol/sdk@1.29.0`**. The split
  v2 SDK is currently **`2.0.0-beta.4`** and explicitly targets the release-candidate protocol.
- MCP Apps **`2026-01-26` is a stable official extension**. The current SDK package is
  **`@modelcontextprotocol/ext-apps@1.7.4`**.
- The replacement Tasks extension is **not ready for Better Convex product work**. Its SEP is Final,
  but the implementation repository calls the extension experimental, has no release, and says it
  is not yet official.
- OAuth Client Credentials is likewise **not ready for a Better Convex public adapter**. Its SEP is
  Final, but the official `ext-auth` repository still files its specification under `draft/`.
- The private topology laboratory may exercise v2 beta bytes to de-risk the July protocol, but no
  public package or support claim may depend on them. Stable-v2 adoption requires a new checkpoint
  after the final specification, stable SDK, and matching conformance tooling are published.

## Base protocol

| Surface                             | Exact status at checkpoint                                                                                                                                                                                     | Authority                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current protocol                    | `2025-11-25`; the versioning page labels it **Current** and ready for use                                                                                                                                      | [MCP versioning](https://modelcontextprotocol.io/docs/learn/versioning), [`2025-11-25` changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog) |
| Next protocol                       | `2026-07-28` release candidate, locked 2026-05-21; final scheduled 2026-07-28                                                                                                                                  | [official release-candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)                                                   |
| Material RC changes relevant to BCN | Stateless requests, no initialization/session protocol, per-request capabilities, official extensions framework, revised Tasks extension, multi-round-trip input, routing headers, and authorization hardening | [official release-candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)                                                   |

The RC's stateless transport and per-request capability model materially affect the Phase 1 topology
decision. Implementing a new public server against the current session-oriented wire protocol and then
adding a compatibility layer would create two transports. The smaller path is to keep the existing beta
implementation frozen, use the v2 beta only inside disposable probes, and make the public topology
decision only after final bytes exist.

## Official TypeScript SDK

| Generation       | Exact version/tag                                                                        | Status                                                                                                       | Source identity                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1               | `@modelcontextprotocol/sdk@1.29.0`, tag `v1.29.0`                                        | Supported production release; npm `latest`                                                                   | [`e12cbd7078db388152f6e839abdbe09ba01f3f32`](https://github.com/modelcontextprotocol/typescript-sdk/commit/e12cbd7078db388152f6e839abdbe09ba01f3f32), [tag](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.29.0)                                                     |
| v2 server/client | `@modelcontextprotocol/server@2.0.0-beta.4`, `@modelcontextprotocol/client@2.0.0-beta.4` | GitHub prerelease and npm `beta`; the SDK README says v1 remains supported for production until v2 is stable | [`e81758caed29f6568ce8873f7f9a3bd65b017d9c`](https://github.com/modelcontextprotocol/typescript-sdk/commit/e81758caed29f6568ce8873f7f9a3bd65b017d9c), [release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/%40modelcontextprotocol%2Fserver%402.0.0-beta.4) |

Registry commands executed:

```text
pnpm view @modelcontextprotocol/sdk version dist-tags --json
# version/latest: 1.29.0

pnpm view @modelcontextprotocol/server version dist-tags --json
pnpm view @modelcontextprotocol/client version dist-tags --json
# version/latest/beta: 2.0.0-beta.4
```

The v2 packages being assigned npm's `latest` tag does not make them stable: their versions contain a
SemVer prerelease identifier, GitHub marks the releases as prereleases, and the official tagged README
explicitly says v1 is the production release until the July final.

## Conformance and Inspector

| Tool            | Current registry release                                 | Status/source                                                                                                                                                                                                                                                                                                   | Current repository pin |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| MCP Conformance | `@modelcontextprotocol/conformance@0.1.16`; npm `latest` | Stable release [`v0.1.16`](https://github.com/modelcontextprotocol/conformance/releases/tag/v0.1.16), commit [`21a9a2febd7100d7c17ac1021ee7f2ed9f66a1e0`](https://github.com/modelcontextprotocol/conformance/commit/21a9a2febd7100d7c17ac1021ee7f2ed9f66a1e0). npm also exposes `0.2.0-alpha.9` under `alpha`. | `0.1.16` exact         |
| MCP Inspector   | `@modelcontextprotocol/inspector@1.0.0`; npm `latest`    | Stable release [`1.0.0`](https://github.com/modelcontextprotocol/inspector/releases/tag/1.0.0), commit [`ac3c1a122a5e072a200c99869fc0cd8bfa660ece`](https://github.com/modelcontextprotocol/inspector/commit/ac3c1a122a5e072a200c99869fc0cd8bfa660ece)                                                          | `0.22.0` exact         |

Registry commands executed:

```text
pnpm view @modelcontextprotocol/conformance version dist-tags --json
# latest: 0.1.16; alpha: 0.2.0-alpha.9

pnpm view @modelcontextprotocol/inspector version dist-tags --json
# latest: 1.0.0
```

The Inspector mismatch is evidence to reconcile in the laboratory, not permission for an unrelated
root dependency update. Phase 1 must first prove which Inspector version matches each protocol/SDK
candidate. Stable conformance `0.1.16` cannot by itself certify release-candidate behavior; any alpha
use must be labeled private evidence and repeated after a stable release.

## MCP Apps

| Item                 | Exact status                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension identifier | `io.modelcontextprotocol/ui`                                                                                                                                                                                              |
| Specification        | `2026-01-26`, **Stable**                                                                                                                                                                                                  |
| SDK                  | `@modelcontextprotocol/ext-apps@1.7.4`, npm `latest`, released from commit [`ca1d29894fabbd1558885a9ec8620dcb01d7457e`](https://github.com/modelcontextprotocol/ext-apps/commit/ca1d29894fabbd1558885a9ec8620dcb01d7457e) |
| Repository state     | Official `modelcontextprotocol/ext-apps`; package exports app, app bridge, React helpers, server helpers, and schema. Vue is an example, not a dedicated SDK export.                                                      |

Authorities: [stable specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
[official announcement](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/),
[SDK repository](https://github.com/modelcontextprotocol/ext-apps), and
[`v1.7.4` release](https://github.com/modelcontextprotocol/ext-apps/releases/tag/v1.7.4).

Registry command:

```text
pnpm view @modelcontextprotocol/ext-apps version dist-tags --json
# version/latest: 1.7.4
```

The root lock currently contains `ext-apps@1.7.4` and `sdk@1.29.0` transitively through development
tooling. That does not admit an Apps public API. Phase 7 still requires a Vue-specific lifecycle and
security proof against exact candidate bytes.

## Tasks

There are two incompatible Tasks designs:

1. `2025-11-25` contains an explicitly **experimental** core Tasks facility.
2. SEP-2663 defines the replacement `io.modelcontextprotocol/tasks` extension for the July stateless
   protocol and states that it is not wire-compatible with the experimental core facility.

The governance label and implementation readiness diverge at this checkpoint:

- [SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension) is marked **Final**.
- The official [`modelcontextprotocol/ext-tasks`](https://github.com/modelcontextprotocol/ext-tasks)
  repository describes itself as **Experimental**, says it is **not an official extension**, and has
  no GitHub release.
- The official [Tasks overview](https://modelcontextprotocol.io/extensions/tasks/overview) still points
  to that experimental implementation.
- Repository HEAD checked: [`2c1425d9a288b9b1f489430fe1e00bb392b47e48`](https://github.com/modelcontextprotocol/ext-tasks/commit/2c1425d9a288b9b1f489430fe1e00bb392b47e48).

Therefore Phase 8 remains blocked. A Final SEP is necessary but not sufficient: Better Convex also
requires a published final extension, compatible stable SDK, conformance scenarios, two relevant
clients, and a real application job that cannot be represented by a normal structured result.

## OAuth Client Credentials extension

The official identifier is `io.modelcontextprotocol/oauth-client-credentials`. The status is also
mixed:

- [SEP-1046](https://modelcontextprotocol.io/seps/1046-support-oauth-client-credentials-flow-in-authoriza)
  is marked **Final**.
- The official [`modelcontextprotocol/ext-auth`](https://github.com/modelcontextprotocol/ext-auth)
  repository lists Client Credentials under **Draft**, at
  [`specification/draft/oauth-client-credentials.mdx`](https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/draft/oauth-client-credentials.mdx).
- The [official extension guide](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)
  describes JWT assertions and client-secret variants, but client support remains opt-in.
- Repository HEAD checked: [`fb374c7db2b34f18ca9183882e0beecdf661892b`](https://github.com/modelcontextprotocol/ext-auth/commit/fb374c7db2b34f18ca9183882e0beecdf661892b).

No Better Convex machine-client product should be built from this checkpoint. Phase 8's separate
interoperability and security gate remains correct.

## Repository reconciliation

At `da3d50cd8794`:

- `package.json` pins `@modelcontextprotocol/conformance` to `0.1.16` and Inspector to `0.22.0`.
- `pnpm-lock.yaml` resolves `@modelcontextprotocol/sdk@1.29.0` and
  `@modelcontextprotocol/ext-apps@1.7.4` transitively.
- Production MCP behavior remains the project's hand-written, selected `2025-11-25` subset. No
  official SDK is a production dependency or public API.

That state is acceptable for the immutable beta line but not the vNext end state. The next work is:

1. inventory and freeze the beta parser/relay as deletion-target evidence (`P1-002`);
2. build one application-owned neutral domain model (`P1-003`);
3. isolate exact v2 beta SDK bytes only for the disposable topology probes (`P1-004`);
4. repeat this checkpoint after the final July specification and stable SDK/conformance releases
   before accepting the topology or beginning public MCP packaging (`P1-015`).

## Reproduction commands

```text
pnpm view @modelcontextprotocol/sdk version dist-tags --json
pnpm view @modelcontextprotocol/server version dist-tags --json
pnpm view @modelcontextprotocol/client version dist-tags --json
pnpm view @modelcontextprotocol/conformance version dist-tags --json
pnpm view @modelcontextprotocol/inspector version dist-tags --json
pnpm view @modelcontextprotocol/ext-apps version dist-tags --json

gh api 'repos/modelcontextprotocol/typescript-sdk/releases?per_page=20'
gh api 'repos/modelcontextprotocol/conformance/releases?per_page=20'
gh api 'repos/modelcontextprotocol/inspector/releases?per_page=10'
gh api 'repos/modelcontextprotocol/ext-apps/releases?per_page=10'
gh api repos/modelcontextprotocol/ext-auth/contents/specification
gh api repos/modelcontextprotocol/ext-tasks/contents/README.md
```

## Authority recheck — 2026-07-24

This checkpoint was repeated before starting any final-protocol or stable Apps work.

- The latest published specification release is still `2025-11-25`, published on 2025-11-25. The
  official release-candidate announcement still schedules the final `2026-07-28` specification for
  2026-07-28.
- The latest split TypeScript SDK remains the prerelease
  `@modelcontextprotocol/server@2.0.0-beta.5` /
  `@modelcontextprotocol/client@2.0.0-beta.5`. No stable v2 release exists.
- The latest official conformance package remains `0.1.16`; its published server scenarios do not
  certify the stateless release candidate. Inspector `1.0.0` remains latest.
- `@modelcontextprotocol/ext-apps@1.7.5` was published on 2026-07-23. Its exact
  [`v1.7.4...v1.7.5`](https://github.com/modelcontextprotocol/ext-apps/compare/v1.7.4...v1.7.5)
  runtime diff adds capability/schema fields but does not change the `App` implementation or provide
  control over its unconditional browser logging. The release's dependency-security change is a
  development-only `sharp` bump; the repository's production advisory gate reports zero active
  exceptions.

Therefore:

1. `EXT-003` remains a real authority gate; `P1-015` and the final interaction surface must not be
   represented as complete four days early.
2. `EXT-006` also remains open. Updating Apps from `1.7.4` to `1.7.5` would not satisfy the missing
   logging-control or real-host evidence, so the exact certified candidate is not churned without a
   protected invariant benefit.
3. The next safe product action remains final-spec reconciliation after actual publication. No
   compatibility parser, provisional URL-interaction API, or console shim is admitted.

Additional exact commands:

```text
gh api repos/modelcontextprotocol/modelcontextprotocol/releases/latest
gh api 'repos/modelcontextprotocol/typescript-sdk/releases?per_page=10'
gh api repos/modelcontextprotocol/ext-apps/releases/tags/v1.7.5
gh api repos/modelcontextprotocol/ext-apps/compare/v1.7.4...v1.7.5
pnpm view @modelcontextprotocol/server versions --json
pnpm view @modelcontextprotocol/client versions --json
```
