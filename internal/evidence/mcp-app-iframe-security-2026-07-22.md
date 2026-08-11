# MCP App iframe security proof — 2026-07-22

## Enforced boundary

The neutral App is delivered as one bounded HTML resource with:

```text
default-src 'none'
script-src 'unsafe-inline'
style-src 'unsafe-inline'
connect-src 'none'
frame-src 'none'
object-src 'none'
base-uri 'none'
```

`unsafe-eval` is absent and the Vue lifecycle pins the official SDK's
`allowUnsafeEval` option to `false`. The host iframe sandbox is exactly
`allow-scripts`; it has no `allow` permissions attribute, `allow-same-origin`,
`allow-popups`, or `allow-forms`.

The App cannot make direct network requests. Its only application operation is
an official AppBridge message which the outer host re-projects onto an exact
allowlisted MCP call.

## Adversarial browser proof

The production Playwright harness proves:

- an HTML/script payload in structured tool output renders as text and creates
  no attacker DOM or executable script;
- the Vue source contains no `v-html` path;
- a sibling iframe's forged JSON-RPC tool-result message is rejected by the
  official transport's source check and cannot replace current state;
- host capability absence cannot be bypassed;
- no unexpected network request, failed request, browser console error, or page
  error occurs;
- repeated mount/teardown does not retain the prior App;
- App HTML, host JavaScript, DOM, bridge messages, tool request bodies, console
  captures, and page errors contain none of the unique cookie, bearer, Convex
  JWT, service-proof, provider-reference, raw-cause, or raw-client sentinels.

The resource metadata independently declares empty resource, connection, frame,
and base-URI domain lists plus an empty browser-permissions object. Exact Apps
SDK schemas validate both tool and resource metadata.

```text
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  1 file, 1 protocol/browser test passed
```

This is the neutral proof. The same matrix must run against the Ginko App and
exact installed tarballs before `P7-011`–`P7-013` can complete.
