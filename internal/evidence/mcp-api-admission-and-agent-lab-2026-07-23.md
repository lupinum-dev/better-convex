# MCP API admission and agent laboratory boundary — 2026-07-23

## Outcome

The mock-model Agent application is no longer a maintained or shipped starter. Its unchanged proof code
and tests now live under `internal/labs/agentic-saas`, outside the public package typecheck and
maintained-candidate matrix. Re-admission requires a real provider-backed path, production deployment,
and exact-package proof.

No MCP export was added. The existing `runMcpTool()` export survived a fresh public-API admission review
because two materially different consumers already depend on the same narrow boundary:

- the neutral OAuth/MCP agent fixture maps explicit note-style application operations;
- Ginko maps explicit CMS operations with its own canonical authorization and domain outcomes.

The helper owns no registration, schema, operation mapping, authorization, retry, persistence, or domain
result vocabulary. It catches only unexpected callback throws, returns one static official
`CallToolResult`, and optionally emits allowlisted metadata. Deleting it would duplicate the
security-sensitive failure/diagnostic boundary in both consumers. The contradictory ADR sentence that
said to add no tool helper was corrected to describe this admitted exception.

## Deleted public claims

- `agentic-saas` was removed from the Nuxt maintained-candidate descriptor;
- the public starters index no longer calls the mock-provider application canonical or shipped;
- shipped-starter auth tests no longer treat the laboratory as product surface;
- the standalone laboratory was excluded from the root public-package typecheck;
- no compatibility path or second copy of the application was retained.

## Proof

- `pnpm check` passed outside the restricted sandbox: formatting, lint, module/server/fixture typechecks,
  13 architecture rules over four public packages, 164 files, and 1,882 tests.
- Focused maintained-candidate, export-manifest, and MCP tool-error suites: 3 files and 40 tests passed.
- Credential-passthrough security regression: 1 file and 1 test passed.
- MCP package typecheck and production build passed. The request-lifecycle hard cut keeps exactly two
  runtime exports: `handleMcpRequest` and `runMcpTool`.
- Exact temporary MCP tarball SHA-256
  `cc45a4c9848bb17212f6c1795752bb725fa4ceec3fd15e59b0d42b03e83a2783` installed into an isolated
  consumer; typecheck, runtime credential proof, installed-byte equality, exact SDK dependency, and
  export allowlist passed.

The first sandboxed full check failed only because the restricted environment denied localhost listeners
and Chromium Mach-port registration. The same full command passed outside that sandbox; no assertion or
production code was changed to accommodate the environment.

## Commit

- `ea3e5a08` — move the mock-provider Agent application from shipped starters into the internal lab.
