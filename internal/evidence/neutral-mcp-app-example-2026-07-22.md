# Neutral MCP App example — 2026-07-22

## Outcome

One small notes App now demonstrates the three RFC UI shapes without three
protocol stacks or three public abstractions:

- **dashboard:** current workspace, status, result count, and note collection;
- **form:** bounded query and result-limit controls submit `search_notes`
  through the official host bridge;
- **preview:** validated note title, body, revision, and URI render as Vue text.

The App has no application SDK. It imports Vue, the exact official Apps SDK,
and `better-convex-vue/mcp-app`. The production module graph rejects Nuxt,
Nitro, H3, Better Auth, Convex, MCP client/server packages, and any root runtime
source.

## Why one App

Dashboard, form, and preview are presentation patterns, not separate transport
or authorization products. One App exercises reactive host input, local form
state, validated results, host-mediated refresh, fallback, navigation, security,
and disposal while retaining one `search_notes` operation and one `ui://`
resource.

Adding three fixtures would duplicate the same AppBridge and certification
surface without proving a new invariant. The materially different second
consumer is Ginko's publish-impact preview in `P7-010`.

## Production proof

The test builds the Vue App and official host harness with production Vite,
embeds the bounded App HTML as the actual MCP resource, serves it through the
selected authenticated MCP handler, and runs the complete official
App/AppBridge browser path.

```text
pnpm exec vitest run test/unit/vnext-mcp-apps-probe.test.ts
  1 file, 1 protocol/browser test passed
```

The proof covers editable form arguments, exact host call arguments, malicious
preview data, repeated result replacement, theme change, partial input,
cancellation, authorization denial, revocation, navigation capability, fresh
remount, and teardown.
