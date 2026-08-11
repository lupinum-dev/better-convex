# MCP topology adversarial HTTP evidence — 2026-07-20

## Scope

This closes private-lab task `P1-009`. It exercises the independently mounted Nitro-native and
Convex-native candidates over real loopback HTTP servers, including raw TCP framing cases that a
Web-standard `Request` cannot manufacture. The shared `http-adversarial.ts` file is test harness only;
it is imported by neither runtime candidate.

The official SDK documentation explicitly leaves Host/Origin validation and request-size policy to the
mounting runtime. Each private candidate therefore implements its own fixed 64 KiB request boundary,
one-second whole-body deadline, encoded-body rejection, exact URL/query check, and `no-store` response
projection before the SDK parses JSON. No public option or shared runtime adapter was introduced.

## Executed results

| Case                                          | Production Nitro node server                                   | Local Convex HTTP action                            |
| --------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Hostile browser `Origin` with valid lab token | `403`                                                          | `403`                                               |
| `Content-Encoding: gzip`                      | `415`                                                          | `415`                                               |
| Non-JSON media type                           | `415`                                                          | `415`                                               |
| Declared request over 64 KiB                  | `413`                                                          | `413`                                               |
| Query on the exact MCP route                  | `404`                                                          | `404`                                               |
| Unsupported method on the exact route         | `405`                                                          | `404` from the Convex router                        |
| Duplicate `Content-Length`                    | Node edge `400`                                                | connection closed before action dispatch            |
| `Content-Length` plus chunked framing         | Node edge `400`                                                | connection closed before action dispatch            |
| Valid JSON split across chunked frames        | `200`                                                          | `200`                                               |
| Chunked body over 64 KiB                      | `413`                                                          | `413`                                               |
| Incomplete chunk held open                    | `408`                                                          | `408`                                               |
| Client abort during incomplete body           | connection aborted; next calls succeed                         | connection aborted; next calls succeed              |
| Concurrent calls                              | bounded calls succeed; earlier two-actor test remains isolated | sixteen alternating Alice/Bob calls remain isolated |

Nitro's application router returns its ordinary HTML application shell with `200` for a different route
such as `/api/mcp/extra`; the test proves the MCP handler marker is absent. This is not MCP dispatch or an
authorization bypass, but it is an operational distinction from Convex's `404` and remains an input to
the topology comparison. Exact-route method and query disagreements fail closed.

Both probes retain credential-response sentinels. Neither authorization bearer appears in captured SDK
responses. Every MCP response emitted by the candidate boundary is `Cache-Control: no-store`.

## Reproduction

```sh
pnpm exec vitest run test/unit/vnext-mcp-nitro-probe.test.ts --reporter=verbose
pnpm exec vitest run --config internal/labs/mcp-topology/nitro/vitest.config.ts --reporter=verbose
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts --reporter=verbose
pnpm exec vue-tsc --noEmit --project tsconfig.json
pnpm exec eslint internal/labs/mcp-topology/http-adversarial.ts internal/labs/mcp-topology/nitro/notes-handler.ts internal/labs/mcp-topology/convex/fixture/convex/mcp.ts internal/labs/mcp-topology/nitro/runtime-purity.integration.test.ts internal/labs/mcp-topology/convex/probe.test.ts
```

Result on 2026-07-20: two Nitro boundary unit tests, one production Nitro build/socket test, and one
freshly deployed local Convex/socket test passed; root type checking and focused lint passed. Loopback
permission is required for the two runtime tests.

## Boundaries of the claim

- These are local production-runtime bytes, not a public cloud deployment. Protected/cloud evidence is
  still required before topology acceptance.
- The probes exercise request streaming. The selected stateless JSON response mode intentionally emits
  terminal JSON rather than progress SSE; final SDK/conformance work must separately exercise every
  response-stream capability the selected public topology claims.
- Host routing is enforced by Nitro's bound origin and Convex's managed deployment router in this lab;
  public topology work must bind configured production hostnames rather than infer authority from the
  incoming header.
