# MCP exact production consumers — 2026-07-22

## Outcome

One freshly packed `@better-convex/mcp@0.1.0-beta.0` tarball passed three closed maintained consumers:

1. a clean Node/type/export consumer;
2. the Better Auth OAuth starter deployed through its real local Convex HTTP Action;
3. the neutral notes application with an independent provider-neutral verifier deployed through a
   second real local Convex HTTP Action.

The production fixtures install the supplied tarball directly. They do not link `packages/mcp`, do not
fall through to the registry, and reject a missing or drifted installed package. The neutral consumer
generates a fresh lock containing the tarball filename and byte-compares its installed package to the
extracted candidate. The Better Auth fixture extracts the same tarball into its isolated deployment and
validates package identity, version, and exact official SDK dependency before Convex code loading.

## Better Auth production path

The previous release evidence depended on Inspector's browser UI and `mcp-remote`. Those clients still
belong in compatibility observation, but they are not reliable release authorities for the locked RC:
their current published versions use the legacy SDK and the Inspector OAuth journey repeatedly failed
to settle against the RC endpoint.

The replacement is smaller and more direct:

```text
browser public client
  -> authorization code + S256 PKCE + exact redirect/state/iss/resource
  -> Better Auth token endpoint
  -> official resource-client signature and claim verification
  -> exact packed MCP package in a Convex HTTP Action
  -> current application authorization in each operation
```

Two independent registered public clients complete this flow. The test then proves current membership,
role, delegation, user, resource, client-resource, session, client, and consent changes, plus the
application's single-use destructive-operation approval. Expected denials are MCP tool results rather
than HTTP authentication failures; missing or invalid bearer credentials remain HTTP OAuth challenges.

The package now permits HTTP issuers only on exact loopback hosts, matching its existing local-resource
rule. Remote plaintext issuers and resources remain invalid. This closes the local-development
asymmetry that the direct end-to-end path exposed.

## Provider-neutral production path

The neutral Convex fixture installs the exact tarball under a fresh lock and uses a materially external
signed-token verifier. Its single deployed HTTP Action proves:

- modern and legacy official SDK clients;
- explicit search, rename, delete, report, and note-resource registration;
- current database authority and tenant isolation;
- idempotent/conflicting writes and read-only scope ceilings;
- protected-resource and authorization-server metadata;
- malformed origin/path/method/content/framing/body/stream/abort behavior;
- concurrent client isolation and bounded response behavior;
- Apps fallback metadata without credentials entering the app;
- no bearer or raw client entering canonical Convex operations.

This consumer is deliberately not Better Auth-shaped and has no Nuxt dependency.

## Executed evidence

```text
node scripts/check-candidate-apps.mjs --package mcp

MCP packed-entry gate:
  5 source files scanned, 1 public entry deep-checked

Clean contract consumer:
  frozen installed identity and bytes passed
  TypeScript 5.9.3 passed
  runtime export allowlist passed

Better Auth consumer:
  7 MCP files, 56 tests passed
  direct PKCE and terminal revocation passed
  MCP 2026-07-28 RC runner passed
  official 2025-11-25 server-initialize, ping, tools-list passed

External verifier Convex consumer:
  1 deployed topology file/test passed
  exact installed-byte comparison passed
  production HTTP, OAuth, application, Apps, concurrency and latency probes passed

Candidate runner matrix passed:
  3 maintained consumers, one exact tarball
```

The protected external deployment remains a final release/governance gate. It does not create another
implementation or permit a stable protocol claim before the final specification and SDK ship.
