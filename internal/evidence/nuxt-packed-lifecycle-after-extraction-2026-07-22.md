# Nuxt packed lifecycle after extraction — 2026-07-22

## Outcome

The private lifecycle extraction is certified in the exact packed root Nuxt package. One clean commit
created one local immutable candidate; every packed probe and maintained consumer installed that same
tarball. No package was published, no tag moved, and no protected environment was invoked.

## Candidate identity

| Field               | Value                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Package             | `better-convex-nuxt@0.8.0-beta.0`                                                                 |
| Source commit       | `654d53d6f07336745fd02268f8e167873b9fa630`                                                        |
| Tarball             | `better-convex-nuxt-0.8.0-beta.0.tgz`                                                             |
| Bytes               | `271094`                                                                                          |
| SHA-256             | `d47b8ebcbd5e3ecaf77a8db2ec8c57d27a1973547666e84fa1002b723a18dbdd`                                |
| SRI                 | `sha512-PdOuQVxO2bNZ4+9SaY7ek0p9aw+0pomKy2YKMJw2AqdnM2O+1S0DkrnkP3JIAYSckSPrhqNQ7yBCnowy34Y6Jw==` |
| Runtime fingerprint | `bcn-release-v1-05d8214dacca9abf1891d9e309b0bb917d8b73e263694d1678d98802395e50da`                 |

The previous Phase 2 artifact for this development version was preserved at
`/tmp/bcn-nuxt-artifact-ebae90b7-20260722` before generating this commit-bound candidate. Reusing it
would have tested the wrong source commit.

## Executed proof

```text
pnpm release:artifact
node scripts/release.mjs verify \
  .release-artifacts/nuxt/0.8.0-beta.0/artifact.json
pnpm check:candidate-apps --tarball \
  .release-artifacts/nuxt/0.8.0-beta.0/better-convex-nuxt-0.8.0-beta.0.tgz
```

The packed-entry gate scanned 160 source files and deep-checked all nine public entries. Its installed
`./server` fixture typechecked, built a production Nitro server, invoked the deterministic local
Convex-protocol endpoint, and verified safe query/mutation/action and diagnostic behavior. The
independent verifier reproduced the content manifest and SBOM and accepted the source commit,
fingerprint, SHA-256, and SRI bindings.

The exact candidate then passed:

- seven pnpm applications: demo, Agency, Agentic SaaS, MCP Agent, MCP OAuth Agent, Public, and Team;
- one pinned npm consumer with lock reference and installed-byte equality;
- all eight typechecks and production builds;
- 221 application tests across Agency (14), Agentic SaaS (55), MCP Agent (101), Public (4), and Team
  (47);
- production root-render checks for Agentic SaaS and MCP Agent;
- production public source-map absence for MCP OAuth Agent; and
- the `auth: false` Public starter.

The optional Agency live-codegen freshness check was skipped because no deployment key was provided;
it is not needed to prove the local packed lifecycle extraction and remains an external-authority check.

## Boundary

This evidence adds no public API and does not certify a public Vue package. It proves only that moving
client lifecycle ownership into the private source island did not break the exact installed Nuxt
artifact. Phase 4 still owns the public Vue package cut and its separate exact-artifact certification.
