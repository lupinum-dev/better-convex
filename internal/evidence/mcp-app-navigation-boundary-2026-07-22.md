# MCP App navigation boundary — 2026-07-22

## Outcome

External navigation remains the official Apps `ui/open-link` operation. Better
Convex does not wrap it, interpret its result as approval, or provide direct
iframe navigation.

The neutral production-browser proof establishes:

- without the host `openLinks` capability, the link control is disabled and no
  URL crosses the bridge;
- with the capability, the App calls the official `app.openLink()` method;
- the host receives exactly
  `https://docs.example.invalid/notes` once and may deny it;
- denial is ordinary navigation failure, not an authorization or approval
  result;
- the iframe bundle contains no `window.open` path;
- the browser makes no request to the external target and remains on the host;
- no locator is placed in model-visible tool output or resource metadata.

```text
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  1 file, 1 protocol/browser test passed
```

This task intentionally does not create a generic queue or high-impact review
protocol. Application-owned authenticated review locators remain Phase 6 and
the Ginko proving consumer (`P7-010`). Their authority, expiry, subject binding,
and replay properties cannot be inferred from a successful `openLink` call.
