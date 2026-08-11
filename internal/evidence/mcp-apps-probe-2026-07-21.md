# MCP Apps Vue boundary probe — 2026-07-21

## Result

`P1-014` passes for both private topology candidates. One production-built Vue `notes-dashboard`
resource is registered through each candidate's official MCP server SDK, validated with the official
MCP Apps schemas, rendered with the official `App` and `AppBridge`, and exercised against each real MCP
client connection. The iframe receives no bearer, cookie, Convex JWT, provider reference, service
proof, raw cause, or raw Convex client.

This proves the shared MCP Apps boundary, not a public Vue API and not a production host implementation.
The official web-host double-iframe sandbox, host-origin enforcement, reusable Vue composables, and exact
package certification remain Phase 7 work.

## Exact authority and dependency boundary

Checked against the published MCP Apps `1.7.4` package and its stable `2026-01-26` extension protocol:

- [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.4/specification/2026-01-26/apps.mdx)
- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [official Vue example](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.4/examples/basic-server-vue/src/App.vue)
- [official web-host implementation](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.4/examples/basic-host/src/implementation.ts)
- [official sandbox proxy](https://github.com/modelcontextprotocol/ext-apps/blob/v1.7.4/examples/basic-host/src/sandbox.ts)

Installed proof tuple:

| Package                          | Version        | Installed `package.json` SHA-256                                   |
| -------------------------------- | -------------- | ------------------------------------------------------------------ |
| `@modelcontextprotocol/ext-apps` | `1.7.4`        | `5f238c430e0c3a62f8be2a918a05da0d09ccf369b695d85237afd92a81f194df` |
| `@modelcontextprotocol/sdk`      | `1.29.0`       | `7ab20eba8fee70f316516b5b3fc45837294caee7e4dd36f2a1593210b0f003ac` |
| `@modelcontextprotocol/client`   | `2.0.0-beta.4` | `48b59bf78fcca2a4049d4cb5abf2e61a5f6165c040445eac65fc047c1b77133a` |
| `@modelcontextprotocol/server`   | `2.0.0-beta.4` | `6c38e338ad5221a0054e040b62e0f8cce0637a9d11b7fb74a44ba396aa42fae8` |
| `playwright`                     | `1.61.1`       | `6b840268612656f0639fb7d68782e8353bdf11518589d30ddf66f283c2670ed5` |
| `vite`                           | `7.3.6`        | `e5ed0f85215f871fe22a48987dcd77fcfbe14064a53c0c9f7f48186a6b7e2cf0` |

MCP Apps `1.7.4` is peer-coupled to the combined v1 SDK. The topology candidates intentionally use the
split v2-beta client/server packages. The probe therefore does **not** import
`@modelcontextprotocol/ext-apps/server`, cast a v2 server/client into a v1 type, or ship two wire
servers. Each candidate registers the normative nested `_meta.ui` fields and UI resource directly
through its existing v2 server SDK; the official Apps schemas validate the emitted metadata. The Vue
iframe and proof host use only the official Apps `App`, `AppBridge`, and `PostMessageTransport` APIs.

## Fixture and artifact

The neutral `search_notes` tool advertises:

```json
{
  "ui": {
    "resourceUri": "ui://notes/dashboard.html",
    "visibility": ["model", "app"]
  }
}
```

The static resource uses exact MIME type `text/html;profile=mcp-app`, empty connect/resource/frame/base
domain lists, no browser permissions, and `prefersBorder: true`. Vite emits one self-contained HTML
document. No generated bundle is committed; the Convex deployment fixture materializes the exact HTML
into its disposable copy before code generation.

Artifact measurement from the passing source state:

```text
app HTML bytes: 334415
app modules: 79
host proof JavaScript bytes: 110752
host modules: 23
app HTML SHA-256: 16a8d14445654306c101dfe13f1fc335dedabf8e3e58a406cd2211380f2a7dba
```

The app bundle contains Vue and the official Apps SDK. Static module inspection rejects the split MCP
client/server packages, the v1 SDK client implementation, Convex browser client, Better Auth, Nuxt,
Nitro, H3, and BCN runtime imports. The host proof contains the Apps bridge but reaches the real MCP
client only through a fixed same-origin, allowlisted test endpoint in the outer host.

## Executed matrix

Both Nitro and a freshly deployed local Convex HTTP action passed:

- Apps-capable initialize advertises `io.modelcontextprotocol/ui` and exact MIME support;
- a baseline client advertises no extension and still receives useful text plus structured
  `search_notes` results; this is a protocol simulation, while real-host compatibility remains
  `P1-023`;
- both clients see the same inert UI metadata; capability support determines host rendering, not server
  authorization or a second state path;
- although the stable Apps specification says servers SHOULD inspect the client capability before
  attaching UI metadata, these stateless candidates deliberately attach the inert metadata
  unconditionally: the server cannot observe the earlier initialize request, unsupported clients ignore
  the namespaced metadata, and the ordinary text plus structured result is complete without it;
- exact UI tool/resource metadata parses through `McpUiToolMetaSchema` and
  `McpUiResourceMetaSchema`;
- the iframe is `sandbox="allow-scripts"` with no `allow` permissions and an application CSP whose
  network, nested-frame, object, and base URI capabilities are empty;
- tool input, first result, repeated result, theme update, graceful teardown, and a fresh second mount
  work through App Bridge;
- malicious result strings render as Vue text and create no element or executed script;
- a sibling frame positively acknowledges posting a forged result, which is then ignored by the
  transport's source check;
- `search_notes` crosses the host allowlist and reaches the real candidate; `rename_note` is denied by
  the host and never reaches MCP;
- absent external-link capability disables the action; advertised capability still remains
  host-mediated and can be denied;
- sentinels are absent from resource bytes, iframe DOM, both-direction bridge messages, host tool body,
  captured console text plus available JSON/`MessageEvent` data, page errors, and MCP responses; the
  independently scanned bridge transcript covers teardown messages whose browser handles expire with
  the removed iframe;
- the browser positively sends an HttpOnly credential sentinel to the outer host while the sentinel
  remains absent from every inspected iframe/bridge/tool/diagnostic surface;
- app network traffic is absent; only the outer host document and its fixed tool endpoint are requested;
- initialization and teardown each occur exactly once per mount.

The server still performs its existing current-state authorization for every actual tool call. The
host allowlist, tool visibility, iframe button state, and link capability are presentation controls and
are not counted as application authority.

## Vue-specific findings carried into Phase 7

Two defects were found and fixed in the private fixture before the proof passed:

1. A Vue reactive proxy cannot be posted through App Bridge (`DataCloneError`). App calls must project
   reactive state into plain structured-cloneable values at the boundary.
2. The official protocol may add request `_meta` to an app-originated tool call. A restrictive host must
   explicitly project the allowlisted `name` and `arguments`; it must not forward the received object as
   an application call envelope.

These are concrete requirements for the later `better-convex-vue/mcp-app` admission and conformance
suite. They do not justify a new generic protocol wrapper in Phase 1.

## Reproduction

```sh
pnpm install --frozen-lockfile --offline
pnpm exec vitest run --project=unit test/unit/vnext-mcp-apps-probe.test.ts
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts
pnpm exec vitest run --project=unit test/unit/vnext-mcp-nitro-probe.test.ts
pnpm exec vue-tsc --noEmit
pnpm exec eslint internal/labs/mcp-topology/apps/notes-dashboard \
  internal/labs/mcp-topology/convex/probe.test.ts \
  internal/labs/mcp-topology/convex/fixture/convex/mcp.ts \
  internal/labs/mcp-topology/convex/fixture/convex/notes_dashboard.ts \
  internal/labs/mcp-topology/nitro/notes-handler.ts \
  test/unit/vnext-mcp-apps-probe.test.ts
pnpm run check:workspace-deps
```

Results: the focused Apps proof passed; the deployed Convex probe passed; the existing Nitro probe's two
tests passed; typecheck, focused ESLint, formatting, frozen install, and workspace dependency alignment
passed.

## Deferred hard gates

- The direct single iframe is intentionally a restrictive private test harness. A public web host must
  implement and prove the official double-iframe sandbox proxy plus origin policy in Phase 7.
- Exact production-host log capture across iframe teardown remains a Phase 7 gate. This probe scans all
  console text, available structured arguments, and the complete independent bridge transcript; it does
  not claim a reusable host logging implementation.
- The published Apps server helper cannot currently own registration in the split v2 topology without
  an unsupported cross-major type/runtime coupling. Re-evaluate after the final v2 SDK rather than add a
  cast or compatibility adapter.
- The 334 KB app is bounded and valid evidence, not a public bundle budget. Phase 7 must measure the
  admitted Vue entry and pursue upstream/tree-shaking improvements if production consumer evidence shows
  the current official root export is materially expensive.
- No public MCP, Vue, or Apps API is admitted by this task. Exact tarball, production host, neutral plus
  Ginko consumer, and full iframe conformance remain `P7-001`–`P7-013`.
