# MCP Apps cross-consumer conformance matrix — 2026-07-22

## Outcome

The official Apps `2026-01-26` lifecycle and security contract now passes as
one composed matrix across the neutral notes consumer and Ginko's materially
different publish-impact consumer.

Protocol-generic behavior stays in the neutral production-Vite browser harness.
Ginko adds only its application-specific contract and authority proof. Copying
the wrong-source, reconnect, transport, and host-capability machinery into
Ginko would create a second test runtime without proving another invariant.

## Executed matrix

| RFC requirement                         | Neutral notes proof                                                                                                 | Ginko publish-impact proof                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| extension advertised and absent         | Official clients initialize with and without `io.modelcontextprotocol/ui`; both retain the same tool/resource truth | Same model-visible tool has complete text/structured fallback; App metadata is optional presentation                |
| valid `ui://` registration and metadata | Official tool/resource schemas validate exact URI, MIME type, visibility, and CSP                                   | Exact `ui://ginko/publish-impact.html`, MIME type, visibility, CSP, and bounded HTML pass                           |
| sandbox and permissions                 | `sandbox="allow-scripts"`; no `allow`, same-origin, popup, or form capability                                       | Same restrictive sandbox and empty permissions                                                                      |
| theme/context                           | Initial light context and later dark update reach readonly Vue state                                                | Initial host theme projects through the shared composable                                                           |
| earliest and later tool input           | Host sends initial input immediately on official initialization; partial and complete later inputs replace it       | Canonical publish input is validated and later reused through host-mediated refresh                                 |
| first/repeated/cancelled results        | Malicious first result, valid replacement, and cancellation update safely                                           | Canonical impact result plus refreshed result render safely                                                         |
| allowed and denied App calls            | `search_notes` allowed; cross-tenant, revoked, and non-allowlisted calls denied                                     | Only `preview-publish` is host-allowlisted; no publish, approval, or review-creation call exists                    |
| external navigation                     | Capability absence disables the action; capability presence still permits host denial only                          | Studio locator uses official `openLink`; host denial changes no application state                                   |
| wrong-source messages                   | Sibling-frame forged result is rejected by the official transport source check                                      | Shared `useMcpApp` and official transport are identical; no consumer-specific transport exists                      |
| malicious result content                | Script/image payload renders only as Vue text; no DOM node or execution                                             | Impact fields are allowlist-parsed and rendered with Vue text interpolation                                         |
| teardown and repeat initialization      | Exact-once teardown, detached iframe, fresh second App, exact-once reinitialization                                 | Exact-once teardown passes in the second consumer                                                                   |
| useful no-App behavior                  | Baseline official client receives exact text and structured search result                                           | Publish preview returns exact text, canonical structured impact, and `publicChanged: false`                         |
| ordinary MCP authorization              | Current tenant and bearer revocation are rechecked on every App call                                                | Current credential scope, active run, CMS caller, contract, role/member, and resource path remain application-owned |
| high-impact authority boundary          | Host controls cannot add backend authority                                                                          | App cannot publish or approve; final review remains authenticated Ginko Studio                                      |

The phrase “capability negotiation controls App delivery” is implemented at the
host presentation boundary. The MCP server does not fork tool discovery or
resource truth based on transient host capabilities. That avoids cache and
authorization differentials while allowing a capable host to render the App
and a baseline host to use the same fallback.

## Commands and results

```text
BCN:
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
pnpm --filter better-convex-vue typecheck
pnpm run check:boundaries

Ginko at 7babc915:
./node_modules/.bin/vitest run test/runtime/mcp-publish-impact-app.test.ts
```

All passed. The complete Ginko repository run at implementation commit
`3368af0e` passed 1,247 tests; the disclosure strengthening at `7babc915`
passed its focused production-browser proof.

## Remaining gate

This closes source-level cross-consumer conformance, not immutable artifact
certification. `P7-013` must install exact Vue and MCP tarballs, prove lock and
installed-byte equality, production-build both capable and baseline consumers,
and rerun the invariant matrix without working-tree aliases.
