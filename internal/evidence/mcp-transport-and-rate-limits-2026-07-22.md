# MCP transport bounds and rate-limit composition — 2026-07-22

## Outcome

The internal Convex-native MCP handler now wraps the official SDK with fixed resource bounds:

| Boundary           | Fixed behavior                                                            |
| ------------------ | ------------------------------------------------------------------------- |
| Request body       | Incremental read, maximum 64 KiB, invalid declared length rejected        |
| Ordinary response  | Incremental read, maximum 1 MiB                                           |
| SSE response       | Preserved as a protocol stream rather than buffered as one unbounded body |
| Handler settlement | 30-second deadline with caller abort propagation                          |
| Public failure     | Empty `no-store` 400/413/502/504 response; no cause or body echo          |

The bounded request bytes are reconstructed without the original `Content-Length`, so the official SDK
parses the same bytes the guard measured. Stalled uploads are cancelled when the caller or deadline
aborts. SSE remains governed by the official SDK's subscription limit and stream lifecycle; tool and
resource payloads remain subject to the separate schema/result bounds in `P5-007` and `P5-009`.

## Rate-limit API admission result

No public rate-limit service, key builder, table, or configuration object was added. The existing handler
composition already gives an explicit tool callback exactly what an application limiter needs:

```text
verified MCP access context
  + explicit registered tool name
  + host-supplied trusted deployment context (when available)
  -> application-owned limiter in the canonical operation
```

This is a short direct call and keeps operation-specific quotas transactionally adjacent to live
application authorization and effects. A generic helper would create a second policy surface without
owning storage, concurrency, or authorization. In a Convex-native deployment without a trustworthy
network attribute, the network dimension is omitted; raw forwarding headers are never substituted.

## Executed evidence

```text
pnpm exec vitest run --project=unit \
  test/unit/mcp-access-verifier.test.ts \
  test/unit/mcp-convex-handler.test.ts \
  test/unit/mcp-transport.test.ts
  3 files, 21 tests passed

pnpm typecheck
pnpm check:boundaries
pnpm --dir packages/mcp build
```

All passed. The focused transport/handler subset contains 16 tests covering exact limits, declared and
streamed overflow, invalid framing lengths, stalled-stream cancellation, ordinary response overflow,
SSE preservation, caller abort, timeout, and empty failure serialization.

The application-composition test proves separate buckets for subject, OAuth client, MCP resource and
issuer, explicit tool, and host-supplied trusted network context. Changing attacker-controlled
`X-Forwarded-For` does not change the bucket. A controlled clock proves window reset, and two concurrent
calls to a one-request bucket produce exactly one allowed result and one rate-limited result. The quota
only denies work; passing it never grants application authority.

## Packaging boundary

The handler and transport remain internal until the remaining Phase 5 schema, error, operation,
authorization, passthrough, and conformance gates pass. The MCP artifact still exposes only its admitted
verifier types; this task does not prematurely stabilize transport options.
