# MCP App different-origin browser proof — 2026-07-23

## Outcome

The neutral production-browser harness no longer injects the App through `iframe.srcdoc`. It serves the
host and App from two distinct HTTPS origins:

```text
host  https://apps-lab.invalid/
app   https://app-frame.invalid/notes-dashboard.html
```

The host CSP allows exactly the App origin in `frame-src`. The iframe retains `sandbox="allow-scripts"`
without `allow-same-origin`, browser permissions, forms, popups, or direct network capability. The host
continues to mediate App Bridge tool calls and external-link requests.

This proves the lifecycle through a separately served origin rather than treating an opaque `srcdoc`
origin as equivalent evidence.

## Credential isolation

The browser installs a secure, `SameSite=Strict`, HTTP-only cookie sentinel for the host. The proof
first observes that cookie on the host document request, then asserts that the App-origin request does
not carry it.

The existing disclosure scan still covers App HTML/module graph, iframe DOM, bridge messages,
host-mediated tool requests, console arguments, errors, MCP results, diagnostics, and every credential
sentinel. Only the host document, exact App document, and allowlisted host tool endpoint are requested.

## Executed proof

```text
pnpm exec oxfmt \
  internal/labs/mcp-topology/apps/notes-dashboard/host-harness.ts \
  internal/labs/mcp-topology/apps/notes-dashboard/browser-proof.ts

pnpm exec eslint \
  internal/labs/mcp-topology/apps/notes-dashboard/host-harness.ts \
  internal/labs/mcp-topology/apps/notes-dashboard/browser-proof.ts

pnpm exec vitest run --project=unit test/unit/vnext-mcp-apps-probe.test.ts
```

Formatting and lint passed. The first browser launch was rejected by the managed macOS sandbox at
Chromium's Mach-port registration before the test ran. The same exact test passed outside that sandbox:
one file and one production-browser test.

## Remaining stable-admission gate

Local production, exact-package, cross-consumer, hostile-message, disclosure, fallback, and
different-origin evidence is complete. The isolated `better-convex-vue/mcp-app` entry remains
experimental because stable admission still requires:

1. a compatible real host, outside the repository harness; and
2. upstream SDK logger suppression/control so ordinary bridge values are not unconditionally written
   to the browser console.

Better Convex will not add a private transport or global console shim to manufacture either result.
