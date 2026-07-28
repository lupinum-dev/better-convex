# MCP stable SDK reconciliation — 2026-07-28

Checked at 2026-07-28 08:43 CEST from the npm registry and official MCP GitHub
repositories.

## Publication status

The split TypeScript SDK is now stable. The official SDK release notes state
that its `2026-07-28` schemas match the final wire revision. The official
specification release is not final yet:

- latest specification release: tag `2026-07-28-RC`, marked prerelease;
- final specification URL `/specification/2026-07-28`: HTTP 404;
- final specification tag `2026-07-28`: HTTP 404;
- stable conformance package: `0.1.16`, with no `2026-07-28` server scenarios;
- conformance `alpha` tag: `0.2.0-alpha.10`, not accepted as final evidence.

This is therefore a stable-SDK reconciliation, not final protocol
certification.

## Exact package authority

| Package                             |  Version | Registry integrity                                                                                |
| ----------------------------------- | -------: | ------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/client`      |  `2.0.0` | `sha512-8f1OghQ2rjzIOfqgUCP+8GiUWqRs89njoWLNqAe8kWmDePv3s1fZXseej+QXemssEuuOvLLmLO/kqM3IQHtISw==` |
| `@modelcontextprotocol/core`        |  `2.0.0` | `sha512-pJCEwGG7Lfr/+PQp9ZTwKXNeO5wzbfKL7H3MYpCorM4oFBoQrdjnBgEoqG+RjhsvS1FKrDbKux+M1HhlnGWqcA==` |
| `@modelcontextprotocol/server`      |  `2.0.0` | `sha512-YhHWdHfpFMQfd0prsEnxKeS3Qz3ytIGmsS0sth4KDjnacIT7hxk6hXHkJ9KysxlkvTM+WZAtQbbcUhdoP4Hvtw==` |
| `@modelcontextprotocol/sdk`         | `1.30.0` | `sha512-xKd8OIzlqNzcqcNumGAa6g+PW2kjD5vrpcKOnfldAUPP3j7lnqMPwlTXQm8gF+UwH72z0lqaRbjr9hqGz0eITA==` |
| `@modelcontextprotocol/ext-apps`    |  `1.7.5` | `sha512-TjPH2S2y5UEGKhmI6+XGFuqfqOV4ppe1x6DA3txnUaEWkgtA4G5vo14jGKFZmegdkZ1H4QMLyujLvoU1BEdnAg==` |
| `@modelcontextprotocol/inspector`   |  `1.0.1` | `sha512-ZMefwjYUFeeiv4eGqi0/GArUmbdGjoo2scvfnI7fbnafigVVdaPPlU5gmES4h2Pr7Bjtefyep4TbqDYdRtySNA==` |
| `@modelcontextprotocol/conformance` | `0.1.16` | `sha512-GI7qiN0r39/MH2srVUR3AXaEN0YLCro20lIBbnvc1frBhszenxvUifBuTzxeVQVagILfBzCIcnungUOma8OrgA==` |

Inspector `1.0.1` is the stable `latest`/`v1-latest` release. Inspector v2 is
only `2.0.0-rc.2` on the `next` tag and is not substituted for a stable tool.

## Hard-cut result

- `packages/mcp` is the sole owner of split server SDK `2.0.0`.
- The root official client is exact `2.0.0`.
- Vue MCP Apps is exact `1.7.5`; its combined v1 SDK peer resolves to exact
  `1.30.0` and does not enter the MCP server package.
- Executable `MCP_RC_*` constants and `runRc*` helpers were deleted, with no
  alias, branch, shim, or second protocol path.
- Result-owned `io.modelcontextprotocol/serverInfo` remains mandatory.
- Per-request `io.modelcontextprotocol/clientInfo` is now treated as optional;
  the stable server is tested both with and without it.
- Unsupported prompts, resources, Tasks, routing mismatches, sessions, and
  unadvertised capabilities continue to fail closed.

The maintained OAuth starter remains on its coherent published beta.9/beta.5
tuple until the coordinated beta.10 candidate exists. Updating only its direct
SDK would load beta.5 through the published package and stable 2.0.0 beside it.
No such dual-runtime state is retained.

## Executed verification

- MCP and Vue package typechecks: passed.
- MCP and Vue package builds: passed.
- MCP project suite: 55 tests passed.
- focused MCP/security/unit suite: 15 tests passed.
- workspace dependency alignment: passed for 21 manifests.
- Vue CycloneDX SBOM: passed with 4 production components.
- exact packed Vue export gate: passed.
- exact temporary packed MCP consumer: passed on server `2.0.0`.
- exact temporary packed Vue MCP App consumer: passed on client/server `2.0.0`
  and Apps `1.7.5`, including an offline frozen reinstall.
- repository format, lint, typecheck, and 14-rule/4-package boundary checks:
  passed.
- full unit/security/Convex/Nuxt/browser behavior matrix excluding the
  clean-commit-only release-artifact fixture: 168 files and 1,964 tests passed.

The temporary beta.21/beta.9 tarballs used for these source checks are not
release candidates and were written only under `/private/tmp`. The previously
certified beta.21/beta.9 artifacts remain superseded for final release.

The release-artifact fixture correctly rejects this uncommitted reconciliation
because reviewed manifest bytes do not yet match `HEAD`. Its 10 expected
dirty-tree failures are not bypassed or relabeled; rerunning that fixture is a
post-commit prerequisite before any candidate preparation.

## Remaining external gates

`P1-015` and `P9-004` remain blocked only on publication and reconciliation of:

1. the final `2026-07-28` specification and changelog;
2. stable official conformance scenarios for that revision;
3. a documented compatible production host and protected deployment evidence.

No beta.22/beta.10 candidate, archive tag, final dossier, or final-compliance
claim is authorized before those gates pass.
