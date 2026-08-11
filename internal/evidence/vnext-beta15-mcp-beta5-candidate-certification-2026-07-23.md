# vNext beta.15 / MCP beta.5 candidate certification

Date: 2026-07-23

## Authority

Vue and Nuxt were built once from the same clean source commit:

```text
db5127cdfeb294d003c9ec3d4b712b89d4589319
```

MCP beta.5 is the retained immutable artifact from:

```text
f4fd5d02b814ce8ee46bbaec8c38c40ec1a80d12
```

No package was published and no tag or dist-tag moved. The first beta.15
attempt stopped before `npm pack` because the machine's global npm cache was
not writable. No artifact or temporary directory was created. Certification
then ran with a task-local npm cache.

## Immutable artifacts

| Package              | Version         | SHA-256                                                            | SRI                                                                                               |
| -------------------- | --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `better-convex-vue`  | `0.8.0-beta.15` | `dd96a27fe097b6537fd28cc56a2e77580c0fe2c9086633ae77f0bfac3560b835` | `sha512-JpedRFIvmgw67G+ZWiGyYz6T78qvEcyL+CHeFae5zqMy5bYgWSFTV7nHgtEtEFaBqaRddSu2AAKFYGuRhJNNBw==` |
| `better-convex-nuxt` | `0.8.0-beta.15` | `4855b990e3f016ee88b4f283e685480caa659fb983578c5568296ad28e6f80e3` | `sha512-+4jjAUM2wzAAd3dQg/5QJTBpTffT9t3LYUcwZAqmbxD51jXeWb/NP4EOAU8D8Th82sHhQw3/GzZDs+NcAh6jxw==` |
| `@better-convex/mcp` | `0.1.0-beta.5`  | `cc45a4c9848bb17212f6c1795752bb725fa4ceec3fd15e59b0d42b03e83a2783` | `sha512-ct1flAjC61ndM2HyBrZiGfCxZNwHKfPwNTOCtJwoHZzP/RQusj86Lb0GYvAlzbKJzgwsuUrP8ovWq75QG3wS6g==` |

The Nuxt runtime fingerprint is:

```text
bcn-release-v1-53f22482645ee2593d415fee01735197250780fec2f50f7d91b088f107a99d6a
```

Evidence files:

- `.release-artifacts/set/0.8.0-beta.15/artifact-set.json`
- `.release-artifacts/vue/0.8.0-beta.15/artifact.json`
- `.release-artifacts/nuxt/0.8.0-beta.15/artifact.json`
- `.release-artifacts/mcp/0.1.0-beta.5/artifact.json`

## Executed proof

`npm_config_cache=/private/tmp/bcn-beta15-npm-cache pnpm release:prepare:set`
passed the closed Vue/Nuxt candidate-set pipeline:

- immutable tarball, content manifest, CycloneDX SBOM, provenance, export, and
  runtime-fingerprint verification;
- `pnpm check`: 163 files and 1,881 tests;
- 253 ASVS controls and 33 authentication invariants;
- eleven isolated production E2E files and the auth-proxy DAST suite;
- npm production/full audits, eight exact GitHub package queries, and imported
  upstream advisories with zero active exceptions;
- deterministic packed auth schema deployment, source/packed auth provenance,
  credential sentinels, concurrency, OAuth
  authorization-code single consumption, MFA, direct PKCE, live authorization,
  terminal revocation, and locked-RC conformance;
- three exact Vue consumers;
- six exact pnpm Nuxt applications, one isolated npm consumer, and the packed
  production Nuxt lifecycle runner.

The maintained OAuth/MCP starter installed MCP beta.5 from its immutable local
tarball, regenerated its lock, and byte-compared the installed package with
the extracted candidate. No registry fallback or workspace link remained.

## Superseded candidates

Vue/Nuxt beta.14 reached the maintained OAuth/MCP consumer only after all
preceding source and artifact gates had passed. That consumer attempted to
resolve unpublished MCP beta.5 from the public registry. Decision `D-040`
retires beta.14 permanently. The corrected consumer matrix passed against the
unchanged beta.14 and MCP beta.5 bytes before beta.15 was reserved.

## Remaining gate

The exact beta.15/beta.5 tuple is eligible for Ginko integration and the final
local security re-review. Publication remains blocked on the protected release
authority and final MCP specification reconciliation described by `EXT-002`,
`EXT-003`, and `EXT-005`.
