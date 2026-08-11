# Ginko OAuth hard-cut evidence — 2026-07-24

## Outcome

Ginko's human-delegated MCP access now uses the existing fixed Better Auth OAuth
authorization-code/PKCE profile and the provider-neutral `@better-convex/mcp`
resource-server boundary. The preconfigured bearer-credential product was
deleted rather than retained as a second accepted path.

The implementation is on Ginko branch
`codex/better-convex-vnext-stabilization`:

- implementation: `d038cb5551e2d9d8b253a83f730fa01ee2a9da2b`;
- certification record: `5f346426`;
- pushed remote branch:
  `origin/codex/better-convex-vnext-stabilization`.

Protected deployment and production cutover remain external operator work under
`EXT-004`. This evidence proves the authorized local source and exact-package
candidate; it does not claim a production cutover.

## Final local ownership model

The hard cut leaves one human-delegated path:

```text
MCP client
  → protected-resource and authorization-server discovery
  → Better Auth authorization code + PKCE
  → fixed OAuth access-token class
  → provider-neutral MCP verifier
  → current provider session/user/client/consent/resource checks
  → current Ginko delegation/member/role checks
  → explicit Convex-native tool or resource
```

The provider-private session identifier remains inside the Nuxt Better Auth
adapter. Access tokens, provider identifiers, cookies, and authorization
headers do not enter tool arguments, results, application access context, or
diagnostics.

Ginko owns only its canonical application authority:

- a delegation binds the current member, OAuth client, resource, scopes, and a
  random generation;
- every protected effect reloads current delegation, member, role, and relevant
  application state;
- agent runs bind the delegation generation and OAuth client so replacement or
  revocation retires previous authority;
- synchronized delegation creation has one active winner.

OAuth scopes remain ceilings, not roles or cached application authority.

## Deleted paths

The implementation removed rather than deprecated:

- Ginko bearer-credential issuance, hashing, admission, and failure-bucket
  tables and functions;
- the legacy bearer-token settings UI, schema, templates, tests, and
  compatibility names;
- the signed-assertion middleware and former alternate MCP routes already
  removed by the single-endpoint hard cut;
- the unexposed `mcpCreateEntry` component mutation and its receipt table,
  eliminating a speculative second entry-creation path outside the registered
  MCP inventory.

Machine-to-machine client credentials remain separately gated and were not
reintroduced through the human delegation flow.

## Executed source proof

Focused OAuth, delegation, discovery, revocation, and disclosure proof:

```text
5 files
32 tests passed
```

The matrix includes:

- protected-resource and authorization-server discovery;
- fixed callback, PKCE, issuer, audience/resource, client, and token-class
  binding;
- immediate session, client, consent, resource, delegation, membership, and
  role revocation;
- synchronized eight-way delegation creation with exactly one active winner;
- legacy bearer rejection and provider/token absence from application
  surfaces.

Broader destructive-operation and transaction proof:

```text
8 files
59 tests passed
```

Full Ginko `pnpm run check` passed:

- formatting, boundary, surface, token, install, compatibility, release-hygiene,
  and ESLint gates;
- contract, component, Nuxt, and Studio typechecks;
- production module and Studio Vite builds;
- 185 test files passed plus one explicitly skipped file;
- 1,229 tests passed plus one explicitly skipped test.

## Exact-package proof

The clean implementation commit was packed twice. Each Ginko archive reproduced
byte-for-byte:

| Package                       | Version      | SHA-256                                                            |
| ----------------------------- | ------------ | ------------------------------------------------------------------ |
| `@lupinum/ginko-cms-contract` | `0.2.0-rc.1` | `ae86a2ed6b16dcb430296de1dc46d4ddcb3865b59419b4d5a6d29cd683dcf7a0` |
| `@lupinum/ginko-cms-convex`   | `0.2.0-rc.1` | `89fece5a5f82250776b485b8bd0bd317e0b27a98d3ae10ba36f62e297874b473` |
| `@lupinum/ginko-cms`          | `0.2.0-rc.1` | `d8931878ef7430b97938f52f0b3c453e5ca1fa6672ded13ad2050ca7406bfadb` |

The exact Better Convex tuple was:

| Package              | Version         | SHA-256                                                            |
| -------------------- | --------------- | ------------------------------------------------------------------ |
| `better-convex-vue`  | `0.8.0-beta.18` | `c66feb7629af679147c106fd2df3b964b523a5d7f5ed87be779eb64724b862f2` |
| `better-convex-nuxt` | `0.8.0-beta.18` | `13889283dfca70a9ae24a694c3bc636fbb9d2cf6182814f7496fe136bf41c041` |
| `@better-convex/mcp` | `0.1.0-beta.6`  | `67c8843a8066554082a21f5fa0454db397bcfa111683fc7839445e11375ca90e` |

The Nuxt runtime fingerprint was:

```text
bcn-release-v1-bc9b69a7706849733c43d6284c385aa4c63c1cf4493da187d0e305b2a5843caf
```

`release:verify:candidate` passed with isolated empty npm and pnpm stores:

- exact installed-byte comparison;
- MCP read and ordinary-write behavior;
- package imports;
- production Nuxt/Nitro build;
- Content safety and portability checks;
- npm audit of 735 packages with zero vulnerabilities;
- `pnpm audit --prod --audit-level low` with no known vulnerabilities.

The retained immutable `@lupinum/ginko-content@0.3.0-rc.5` archive matched its
committed SHA-256
`dffa7b7b49da19d28180a2ea61e53de92dc350818e32fe8a5e623f8ffe7e25a1`.
Its sibling worktree contained unrelated later changes and its local manifest
had been overwritten by an ineligible dirty pack. Candidate construction used
the previously certified archive and reconstructed a temporary manifest from
the committed compatibility tuple and earlier candidate record. The packer
independently rechecked package name, version, archive name, and SHA-256; no
dirty Content bytes entered this candidate.

## Migration decision closure

The Ginko migration now has explicit outcomes for:

- agent runs: canonical Ginko records bound to current delegated authority;
- identity: standard OAuth token provenance plus current application state;
- high-impact confirmation and receipts: existing application-owned review
  records, not a Better Convex approval database;
- human bearer issuance: deleted and replaced by authorization-code/PKCE;
- polling and deferred work: no speculative Tasks or second job source;
- ordinary writes: remain ordinary explicit tools with live authorization.

This closes local migration tasks `P9-024` and `P9-008`. The next local gate is
the fresh offensive-security review in `P9-010`; final MCP specification
reconciliation remains the narrow `EXT-003` task after publication.
