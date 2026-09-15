# MCP finite-profile corrections and frozen execution — 2026-09-15

## Scope and result

This record covers the uncommitted release-completion source based on
`cfb892ae9f514528e6e6fa85454bfdd84dc2b486`. It is not an immutable package
certification, an OAuth certification, or a complete MCP conformance pass.
No package was minted or published for this check.

Two concrete protocol gaps are corrected:

- A modern request without `MCP-Protocol-Version` fails before dispatch with
  HTTP 400 and JSON-RPC `-32020`.
- Unavailable `subscriptions/listen` fails with HTTP 404 / `-32601`, preserving
  the request ID. SDK 2.0.0 intercepts that method before registered handlers,
  and its zero-capacity option emits HTTP 200 / `-32603` instead. The package
  corrects only that exact SDK response after official classification and
  request validation. It preserves preceding header, version, authentication,
  Origin and parse failures. It opens no subscription stream.

A new optional `requestState(access)` factory exposes only the official SDK
`ServerOptions.requestState.verify` hook. The factory receives freshly verified
access provenance. The SDK runs the returned hook before the application
callback and supplies its decoded return value. This lets applications reject
invalid echoed state as the SDK's sanitized JSON-RPC `-32602` error before
high-level tool error conversion. The package adds no codec, secret, bearer
forwarding or request-state store. Applications still own expiry, integrity,
request/principal binding, live authorization and any one-time consumption.
The unconfigured path keeps the SDK's raw-state behavior.

The subscription correction is a pinned SDK workaround tracked in
`internals/migrations.md`. Remove it when the selected official SDK exposes a
supported way to disable subscription dispatch and itself returns the required
404 / `-32601`, with the existing precedence and correlation regressions passing.

## Focused verification

Executed in the shared release-completion worktree:

```sh
corepack pnpm exec vitest run --project=unit test/unit/mcp-request-state.test.ts test/unit/mcp-unsupported-subscriptions.test.ts test/unit/mcp-header-contract.test.ts test/unit/mcp-tool-scopes.test.ts test/unit/mcp-request-lifecycle.test.ts test/unit/mcp-transport.test.ts test/unit/vnext-mcp-sdk-transport.test.ts
corepack pnpm exec tsc --noEmit -p packages/mcp/tsconfig.json
```

All **72 tests in seven files pass**. They cover the real official SDK header
contract, tool scope challenges, finite transport/lifecycle, subscription
rejection, and SDK HMAC-codec state verification. State negatives include
modified bytes, expiry, cross-principal, cross-client, cross-tool,
cross-project and non-string input. Successful resumption returns decoded
state; denied credentials never construct the state verifier. Rejection never
runs the tool, and private verifier errors do not reach the response.

## Full frozen upstream run

The unmodified official conformance checkout is pinned to
`7169291ec0b68eb370fddcd9947313ab0d5e4156`. Its existing frozen-lockfile build was
reused with matching source, lockfile, requirements and executable hashes. The
run used all `2026-07-28` requirements; no expected-failure baseline, exclusion,
legacy relay or protocol-header/body rewrite was applied:

```sh
node /tmp/bcn-mcp-conformance-7169291/dist/index.js server --url <owned-loopback>/mcp --requirements 2026-07-28 --timeout 10000 -o .cache/conformance-2026-07-28/results
```

The disposable loopback adapter invokes the actual source `handleMcpRequest`
with official server SDK `2.0.0`. The upstream CLI has no bearer/header input,
so the adapter supplies an ephemeral synthetic bearer for its test-only
verifier. This is protocol evidence, not a test of deployed bearer enforcement
or OAuth. The fixture preserves request bodies, protocol headers and Origin.
Its request-state examples now use the official HMAC codec through the new
pre-handler verification hook. No credentials or live application data are
used. The owned fixture process was stopped.

**Raw exit code: 1.** All 50 scenario results remain in the ignored
`.cache/conformance-2026-07-28/results` directory. The original upstream output
is `upstream.log`, the executed adapter is `fixture.ts`, and `receipt.json`
binds their implementation/referee fingerprints and full result inventory.
No failing row was discarded or reclassified.

| Result set | Scenarios | Passing scenarios | Failing scenarios | SUCCESS | FAILURE | INFO | SKIPPED |
| ---------- | --------: | ----------------: | ----------------: | ------: | ------: | ---: | ------: |
| Scored     |        37 |                27 |                10 |     104 |      10 |    1 |       5 |
| Unscored   |        13 |                 4 |                 9 |      44 |      30 |    0 |       1 |

The stateless scenario now passes all 25 scored checks. Its five subscription
notification checks are upstream SKIPPED because this profile correctly
rejects subscriptions. The tampered-state scenario passes both checks and
records the SDK `Invalid or expired requestState` error. These are corrected
rejections, not claims of subscription delivery or application authorization.

### Remaining failures and deliberate limits

- Five prompt scenarios, prompt caching and prompt-based MRTR fail because
  prompts are outside the finite profile. Tool and resource MRTR remain usable.
- Completion and progress fail because completion and streaming notifications
  are outside the profile. Finite JSON results remain supported.
- The positive localhost-Origin scenario fails because the authenticated
  resource intentionally accepts no browser Origin. Hostile Origin also fails
  closed. The specification requires Origin validation; it does not require
  this resource to accept cross-origin browser MCP traffic.
- Nine unscored task-extension scenarios fail because their task capability
  and fixture tools are absent. The task-notification case is upstream SKIPPED.
- JSON Schema 2020-12 and standard/custom HTTP headers pass all 32 checks, but
  the frozen upstream requirements mark these scenarios unscored/pending.

These raw failures prevent a claim of complete frozen-suite conformance. They
do not justify adding prompts, task orchestration, SSE or permissive Origin
behavior to this package. Release claims must identify the finite supported
profile and keep its actual results visible.

### Full result inventory

| Scenario                                      | Scoring  | SUCCESS | FAILURE | SKIPPED | INFO |
| --------------------------------------------- | -------- | ------: | ------: | ------: | ---: |
| caching                                       | scored   |       7 |       1 |       0 |    0 |
| completion-complete                           | scored   |       1 |       1 |       0 |    0 |
| dns-rebinding-protection                      | scored   |       1 |       1 |       0 |    0 |
| http-custom-header-server-validation          | unscored |      10 |       0 |       0 |    0 |
| http-header-validation                        | unscored |      14 |       0 |       0 |    0 |
| input-required-result-basic-elicitation       | scored   |       3 |       0 |       0 |    0 |
| input-required-result-basic-list-roots        | scored   |       3 |       0 |       0 |    0 |
| input-required-result-basic-sampling          | scored   |       3 |       0 |       0 |    0 |
| input-required-result-capability-check        | scored   |       2 |       0 |       0 |    0 |
| input-required-result-ignore-extra-params     | scored   |       2 |       0 |       0 |    0 |
| input-required-result-missing-input-response  | scored   |       2 |       0 |       0 |    0 |
| input-required-result-multi-round             | scored   |       4 |       0 |       0 |    0 |
| input-required-result-multiple-input-requests | scored   |       3 |       0 |       0 |    0 |
| input-required-result-non-tool-request        | scored   |       1 |       1 |       0 |    0 |
| input-required-result-request-state           | scored   |       3 |       0 |       0 |    0 |
| input-required-result-result-type             | scored   |       2 |       0 |       0 |    0 |
| input-required-result-tampered-state          | scored   |       2 |       0 |       0 |    0 |
| input-required-result-unsupported-methods     | scored   |       2 |       0 |       0 |    0 |
| input-required-result-validate-input          | scored   |       3 |       0 |       0 |    0 |
| json-schema-2020-12                           | unscored |       8 |       0 |       0 |    0 |
| prompts-get-embedded-resource                 | scored   |       1 |       1 |       0 |    0 |
| prompts-get-simple                            | scored   |       1 |       1 |       0 |    0 |
| prompts-get-with-args                         | scored   |       1 |       1 |       0 |    0 |
| prompts-get-with-image                        | scored   |       1 |       1 |       0 |    0 |
| prompts-list                                  | scored   |       1 |       1 |       0 |    0 |
| resources-list                                | scored   |       2 |       0 |       0 |    0 |
| resources-read-binary                         | scored   |       2 |       0 |       0 |    0 |
| resources-read-text                           | scored   |       2 |       0 |       0 |    0 |
| resources-templates-read                      | scored   |       2 |       0 |       0 |    0 |
| sep-2164-resource-not-found                   | scored   |       4 |       0 |       0 |    0 |
| server-sse-multiple-streams                   | scored   |       1 |       0 |       0 |    1 |
| server-stateless                              | scored   |      25 |       0 |       5 |    0 |
| tasks-capability-negotiation                  | unscored |       1 |       4 |       0 |    0 |
| tasks-dispatch-and-envelope                   | unscored |       3 |       6 |       0 |    0 |
| tasks-lifecycle                               | unscored |       1 |       8 |       0 |    0 |
| tasks-mrtr-composition                        | unscored |       1 |       1 |       0 |    0 |
| tasks-mrtr-input                              | unscored |       1 |       3 |       0 |    0 |
| tasks-request-headers                         | unscored |       2 |       3 |       0 |    0 |
| tasks-request-state-removal                   | unscored |       1 |       1 |       0 |    0 |
| tasks-required-task-error                     | unscored |       1 |       1 |       0 |    0 |
| tasks-status-notifications                    | unscored |       0 |       0 |       1 |    0 |
| tasks-wire-fields                             | unscored |       1 |       3 |       0 |    0 |
| tools-call-audio                              | scored   |       2 |       0 |       0 |    0 |
| tools-call-embedded-resource                  | scored   |       2 |       0 |       0 |    0 |
| tools-call-error                              | scored   |       2 |       0 |       0 |    0 |
| tools-call-image                              | scored   |       2 |       0 |       0 |    0 |
| tools-call-mixed-content                      | scored   |       2 |       0 |       0 |    0 |
| tools-call-simple-text                        | scored   |       2 |       0 |       0 |    0 |
| tools-call-with-progress                      | scored   |       1 |       1 |       0 |    0 |
| tools-list                                    | scored   |       4 |       0 |       0 |    0 |

### Source and referee fingerprints

| Input                      | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| handler.ts                 | `95bd2f85e6bb5944238538a353a8c4f5fc7faf7eef30274803a480a2628afe56` |
| transport.ts               | `a0ba6eeeca8b9569d7925cf02f98aa5f786b23ba9a27fcfae1376cdf3543777a` |
| tools.ts                   | `a61e226c8479c2a3c34753c1764fdc3ffcfcf1a43bb204fa20b8947eeccaec24` |
| fixture.ts                 | `c00f5f52f9f8bb919144331548008ad723421a9bfa5f18f1be01ac6efe631c01` |
| Upstream requirements      | `ae2f4f6210fd729e2e318edd5bbfa31a43cee0bc608e48052fa26dbf1d939b57` |
| Upstream package-lock.json | `8c30fe8f15735bc4660c682225b12ec84bbd08c22e839127445d06b5476c4945` |
| Upstream dist/index.js     | `441ae3240a329a69239e940ad5cab8128dd178db0e628c58332b0d3527e287b7` |

## Primary references

- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Multi Round-Trip Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
- [Frozen requirements](https://github.com/modelcontextprotocol/conformance/blob/7169291ec0b68eb370fddcd9947313ab0d5e4156/requirements/2026-07-28.yaml)
- The installed official SDK 2.0.0 `ServerOptions.requestState`,
  `createRequestStateCodec` and `CreateMcpHandlerOptions.maxSubscriptions`
  declarations and corresponding implementations.
