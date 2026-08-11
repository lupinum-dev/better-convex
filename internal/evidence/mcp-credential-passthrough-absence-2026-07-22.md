# MCP credential passthrough absence proof — 2026-07-22

## Outcome

The selected MCP handler consumes the raw bearer only at the provider-neutral verifier boundary.
Provider-private state remains inside the verifier closure. Application operations receive only explicit
issuer/subject provenance and validated tool input.

## Executed sentinel proof

`test/security/mcp-credential-passthrough.test.ts` places unique raw-bearer and private-provider-reference
sentinels in the verifier and in an unexpected downstream error. It exercises the official client,
streamable HTTP transport, selected handler, explicit tool callbacks, opaque error projection, and safe
diagnostic sink.

The test proves both sentinels are absent from:

- captured canonical application arguments;
- structured and text tool results;
- every encoded HTTP response body;
- allowlisted diagnostics;
- all console methods.

The verifier output contains no provider reference, the application access context contains no token,
and the unknown error remains the static `Tool execution failed` result.

Commands:

```text
pnpm exec vitest run test/security/mcp-credential-passthrough.test.ts test/unit/mcp-access-verifier.test.ts test/unit/mcp-tool-errors.test.ts --reporter=dot
pnpm --filter @better-convex/mcp typecheck
pnpm run check:boundaries
```

Exact packed-byte and deployed-log absence is repeated by `P5-023`; this proof closes the maintained
source/runtime boundary without claiming that later artifact gate early.
