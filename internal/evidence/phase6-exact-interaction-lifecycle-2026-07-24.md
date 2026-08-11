# Phase 6 exact interaction lifecycle proof — 2026-07-24

## Outcome

`P6-014` passed its complete local exact-artifact gate. The private locked-RC interaction implementation
is exercised through immutable installed Vue, Nuxt, MCP, and Ginko candidate bytes rather than workspace
or source aliases. Protected staging remains an external release gate and no interaction API is publicly
exported.

## Better Convex candidates

The Vue/Nuxt candidate set was built once from clean commit
`c53e50fd020aefe3255aad5e380740dea891a6fa`:

| Package              | Version         | SHA-256                                                            | SRI                                                                                               |
| -------------------- | --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `better-convex-vue`  | `0.8.0-beta.18` | `c66feb7629af679147c106fd2df3b964b523a5d7f5ed87be779eb64724b862f2` | `sha512-VdaHQ3wmuw3MUFvCB+cn3+3Dx/ael/me2jRLcsdCYlC+JaP2OnJqsS6q4+tX9EOODZMjgtMbo0/hIT3hUrDqwQ==` |
| `better-convex-nuxt` | `0.8.0-beta.18` | `13889283dfca70a9ae24a694c3bc636fbb9d2cf6182814f7496fe136bf41c041` | `sha512-yvF+DaDqggTnc4mDLHnbt74SZGznh2zO5E9q3TUumFqPO+nsugUa+f+VVgbAAkrkC3h2lFdn4MR6kUoQPzUEjw==` |

The Nuxt runtime fingerprint is
`bcn-release-v1-bc9b69a7706849733c43d6284c385aa4c63c1cf4493da187d0e305b2a5843caf`.
The immutable set manifest is
`.release-artifacts/set/0.8.0-beta.18/artifact-set.json`.

The MCP candidate was built once from clean commit
`fb4609af33be546507760d682947a66bce17b189`:

| Package              | Version        | SHA-256                                                            | SRI                                                                                               |
| -------------------- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@better-convex/mcp` | `0.1.0-beta.6` | `67c8843a8066554082a21f5fa0454db397bcfa111683fc7839445e11375ca90e` | `sha512-XhLX3VhnbRuSag18csHklBC9YoPL+Kse2cUIqff8EsdVc7j/PZH+XYGQo33uGqp0/h0qIupOG1OCHYgg4MUQbg==` |

Its evidence is `.release-artifacts/mcp/0.1.0-beta.6/artifact.json`. Each package evidence includes a
content manifest and CycloneDX SBOM. Installed package contents were compared with the extracted
candidate; no workspace link or rebuilt substitute certified the package.

Candidate versions `0.8.0-beta.16`, `0.8.0-beta.17`, and `0.1.0-beta.5` were retired rather than rebuilt.
The beta 17 candidate set correctly failed the canonical source-format gate. The only correction was
committed before reserving beta 18.

## Better Convex executed gate

The beta 18 candidate set and beta 6 MCP candidate passed:

- the repository `check` and `verify` gates;
- 164 test files and 1,889 tests;
- authentication schema, provenance, upstream, adapter, OAuth, fuzz, sentinel, mutation, concurrency,
  MFA, and advisory checks;
- MCP locked-RC client, conformance, PKCE, revocation, malformed-request, bounds, timeout, abort,
  credential-sentinel, and external-verifier checks;
- deployed Convex interaction authorization, stale-impact, replay, transaction, status recovery, and
  disclosure tests;
- exact Vue anonymous, authenticated, embedded, and MCP App consumers;
- five maintained packed pnpm applications, an isolated npm consumer, and the production packed Nuxt
  authentication lifecycle;
- production Vite, Nuxt/Nitro, and documentation builds;
- SHA-256, SRI, content-manifest, SBOM, runtime-fingerprint, and candidate-set verification.

The release commands were the reviewed static package lanes:

```text
node scripts/release.mjs prepare --package mcp
node scripts/prepare-candidate-set.mjs prepare
node scripts/prepare-candidate-set.mjs verify \
  .release-artifacts/set/0.8.0-beta.18/artifact-set.json
```

No tag moved and no package was published.

## Exact Ginko consumer

Ginko commit `1f124cef3bbe7a92c046b6d5a28e5c5f3003b10f` binds its manifests, lockfile,
compatibility record, and candidate pack to the exact package hashes above. Its candidate pack contains:

| Package                                  | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `@lupinum/ginko-cms-contract@0.2.0-rc.1` | `d3ff52d533b6fffbf744515995185385884347a91dcac6352d166bf5c5dbc158` |
| `@lupinum/ginko-cms-convex@0.2.0-rc.1`   | `d871b4a8c7e98242ac61941f9e85a31ef64fc143ac333c561e71c33683259eef` |
| `@lupinum/ginko-cms@0.2.0-rc.1`          | `1af558381490d187e59c546714e01a04907d99221634e62b3b108c97d0407b76` |
| `@lupinum/ginko-content@0.3.0-rc.5`      | `dffa7b7b49da19d28180a2ea61e53de92dc350818e32fe8a5e623f8ffe7e25a1` |

The retained Content archive is the previously certified clean artifact from
`fd7e8fda6e60c61244424941c4811c09d626be6f`; a later dirty Content worktree was not repacked.

Ginko's complete local candidate verifier passed:

```text
pnpm_config_verify_deps_before_run=false pnpm release:verify:candidate
```

The explicit pnpm setting prevents its automatic dependency-repair preflight from attempting to fetch
the intentionally unpublished candidate versions. It does not bypass any repository verification. The
command then ran the normal `check`, pnpm package consumer, npm package consumer, and production audit.

Results:

- formatting, lint, release hygiene, compatibility, all typechecks, package builds, and production
  Studio Vite build passed;
- 182 test files and 1,209 tests passed; one explicitly skipped test remained;
- isolated pnpm and npm consumers installed the exact candidate archives, exercised packed MCP
  read/write behavior, verified package imports, and built production Nuxt/Nitro;
- both consumers passed portable-content and content-safety probes;
- npm audited 734 installed packages with zero vulnerabilities;
- `pnpm audit --prod --audit-level low` reported no known vulnerabilities.

Ginko commit `c7c03f53` records the final exact-candidate evidence. Local materialization of unpublished
tarballs lives only under ignored verification directories; committed manifests remain exact registry
contracts and contain no file, workspace, Git, or source-alias substitute.

## Boundary and remaining gate

This proof certifies the difficult application behavior against exact local candidate bytes. It does not:

- declare the locked `2026-07-28` release candidate to be a final MCP specification;
- admit or export the private interaction adapter as a stable public API;
- replace final SDK/schema/conformance reconciliation;
- replace protected deployment, compatible real-host, registry, provenance, or publication evidence.

The next local task is `P6-015`: document ordinary writes, same-user interaction, application reviewer
queues, retry/status, and external-effect limits without exposing the private RC adapter. Protected
staging remains tracked independently and does not justify an alternate publication path.
