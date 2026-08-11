# Ginko MCP atomic-admission stabilization — 2026-07-23

## Scope

- Ginko branch: `codex/better-convex-vnext-stabilization`
- Completion commit: `625588dd`
- Stabilization task: `S5-003`

## Change

The selected Convex-native MCP ingress no longer performs a read-only failure
budget check, credential lookup, and failure recording as separate calls.
`mcpCredentials.admitAccessBySecretHash` now owns one Convex mutation that:

1. reads the IP and credential failure buckets;
2. rejects an exhausted budget;
3. resolves the hashed credential and its current member;
4. returns current access without recording a failure; or
5. records the invalid attempt in both buckets and returns `invalid | limited`.

The HTTP action derives opaque SHA-256 bucket keys from Convex request metadata
and the already-hashed credential. Neither the bearer nor the client IP enters
tool arguments, results, diagnostics, or application callbacks.

The verifier consumes the explicit `access | invalid | limited` result. It does
not infer successful admission from a nullable lookup.

The Ginko MCP App proof was also hard-cut from the removed raw SDK `App` access
to Better Convex's narrow `callServerTool` and `openLink` lifecycle operations.

## Executed proof

```text
./node_modules/.bin/vitest run \
  test/component/mcpCredentials.test.ts \
  test/component/mcpAuthLimiter.test.ts \
  test/component/contract-write-invariants.test.ts \
  test/runtime/mcp-pilot.test.ts \
  test/runtime/mcp-publish-impact-app.test.ts

./node_modules/.bin/eslint <changed files> \
  --max-warnings=0 --no-warn-ignored

./node_modules/.bin/convex codegen \
  --component-dir packages/convex/src

./node_modules/.bin/tsc \
  -p packages/convex/tsconfig.json --noEmit
```

Results:

- 5 files and 25 tests passed.
- Five synchronized invalid admissions were recorded exactly once in each
  bucket; the next admission was limited. A valid admission wrote no failure
  bucket.
- The real Convex component reference, request metadata, HTTP handler, official
  MCP verifier, tool calls, App fallback, and App refresh path passed.
- Focused lint, diff hygiene, generated component bindings, and the Convex
  package typecheck passed.

The pinned code generator uploaded this component revision to Ginko's configured
development deployment while generating the canonical bindings. Final live
HTTP concurrency and exact-tarball repetition remain mandatory under `S6-004`;
this proof does not certify a release artifact.

## Remaining deletion

The legacy Nitro ingress and its split limiter façades still exist. `S5-004`
deletes that ingress, the obsolete public check/record path, the signed bridge,
and the pilot/code route aliases so the atomic mutation becomes the only
admission policy.
