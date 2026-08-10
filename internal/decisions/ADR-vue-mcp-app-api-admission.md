# ADR: minimal Vue MCP App lifecycle admission

- Status: amended after stabilization audit; experimental only
- Date checked: 2026-07-28
- Extension basis: MCP Apps `2026-01-26`
- SDK basis: exact `@modelcontextprotocol/ext-apps@1.7.5`
- Decision task: `P7-001`

## Decision

Admit one optional `better-convex-vue/mcp-app` entry and one composable,
`useMcpApp()`. It will own the official `App` instance's Vue mount/unmount
lifecycle and project official host notifications into non-deep reactive,
structured-clone-safe state.

The composable keeps the mutable official `App` private. It exposes only the
two host operations required by both proving consumers: `callServerTool` and
`openLink`. Inputs and results cross an explicit structured-clone boundary;
operations reject before readiness and retire results after disposal.

The exact SDK's automatic resize observer cannot be disposed because
`connect()` discards the cleanup returned by `setupSizeChangedNotifications()`.
The wrapper therefore fixes `autoResize: false` and exposes no resize option.

Candidate shape for implementation proof:

```ts
const mcp = useMcpApp({
  implementation: { name: 'notes-dashboard', version: '0.1.0' },
  capabilities: {},
})

// Official SDK method; no Better Convex tool-call abstraction.
await mcp.callServerTool({ name: 'search_notes', arguments: query })

type McpAppLifecycle = {
  callServerTool: App['callServerTool']
  openLink: App['openLink']
  phase: Readonly<Ref<'idle' | 'connecting' | 'ready' | 'error' | 'closed'>>
  error: Readonly<
    ShallowRef<
      | {
          readonly code: 'MCP_APP_CONNECT_FAILED' | 'MCP_APP_CLONE_FAILED'
          readonly message: string
        }
      | undefined
    >
  >
  hostCapabilities: Readonly<ShallowRef<McpUiHostCapabilities | undefined>>
  hostContext: Readonly<ShallowRef<McpUiHostContext | undefined>>
  hostVersion: Readonly<ShallowRef<Implementation | undefined>>
  toolInput: Readonly<ShallowRef<McpUiToolInputNotification['params'] | undefined>>
  toolInputPartial: Readonly<ShallowRef<McpUiToolInputPartialNotification['params'] | undefined>>
  toolResult: Readonly<ShallowRef<McpUiToolResultNotification['params'] | undefined>>
  toolCancelled: Readonly<ShallowRef<McpUiToolCancelledNotification['params'] | undefined>>
}
```

Names remain experimental until the exact package and two consumers pass. The
implementation may reduce the return shape when tests show a field is redundant;
it must not add more surface without another admission result.

## Exact authority

Registry checks on 2026-07-28 show:

```text
@modelcontextprotocol/ext-apps latest: 1.7.5
registry integrity: sha512-TjPH2S2y5UEGKhmI6+XGFuqfqOV4ppe1x6DA3txnUaEWkgtA4G5vo14jGKFZmegdkZ1H4QMLyujLvoU1BEdnAg==
```

MCP Apps is an official extension. The framework-neutral SDK exports `App`,
`PostMessageTransport`, the notification/context types, theme helpers, and
host-bound operations. It provides React hooks but no Vue lifecycle entry. Its
official Vue example constructs the App on mount and does not close it on Vue
scope disposal.

The Apps server helper is peer-coupled to combined
`@modelcontextprotocol/sdk@^1.29.0` (resolved here as exact `1.30.0`), while
`better-convex-mcp` uses split `@modelcontextprotocol/server@2.0.0`. Do not import the server helper,
cast between majors, ship both server runtimes, or add a compatibility wrapper.
Server-side Apps metadata remains direct official v2 registration until an
official compatible helper exists. `P7-004` must record that hard cut rather
than forcing its originally illustrative “adapter” wording.

## Repeated consumer need

The neutral notes dashboard already proves the complete lifecycle against the
deployed Convex topology. It needs current tool input/result, host context,
host-mediated `search_notes`, optional external navigation, repeated mounts,
and exact teardown.

Ginko's canonical publish flow provides a materially different consumer. Its
existing `preview-publish`, `request-publish-review`, and `get-review-status`
operations expose current publish impact and a human-owned review queue. A
read-only publish-impact App needs the same bridge lifecycle, validated tool
result projection, host context, host-mediated status refresh, and optional
navigation to the authenticated queue. It must not publish or approve.

Neither consumer needs a direct Convex client, bearer token, Better Auth
session, approval protocol, or application permission abstraction in the
iframe.

## Direct official SDK comparison

The official SDK already owns and Better Convex must reuse directly:

- app/host initialization and the postMessage transport;
- host capability and context types;
- tool input, partial input, result, cancellation, and teardown notifications;
- server tool/resource calls, messages, links, downloads, display modes, and
  app-local tools;
- CSP-compatible parsing and protocol error behavior;
- theme/font/style application helpers.

The direct SDK intentionally does not own:

- Vue mount and scope disposal;
- readonly Vue refs for changing host/tool state;
- retirement of callbacks after component disposal;
- projection of Vue reactive proxies into structured-cloneable values.

Those four gaps are the admitted Vue integration. The private probe found a
real `DataCloneError` when a Vue proxy crossed App Bridge, and proved that an
allowlisting host must re-project app-originated calls rather than forward the
received envelope.

## Public API admission test

1. **Can code be deleted?** Yes. Both Apps otherwise repeat constructor,
   listener setup, connect state, host-state synchronization, listener removal,
   and close behavior.
2. **Can the official SDK solve it directly?** It supplies every protocol
   operation but has no Vue lifecycle integration. Its Vue example demonstrates
   the repeated glue and omits scope cleanup.
3. **Two consumers?** Neutral notes and Ginko publish-impact/review-status have
   distinct domains and authority models but require the same iframe lifecycle.
4. **One source of truth?** The official `App` remains the protocol owner. Refs
   are disposable projections of current official notifications.
5. **Derived-state rebuild story?** A fresh mount creates a fresh App and refs;
   unmount removes listeners, closes the App exactly once, and retires late
   callbacks.
6. **Authorization owner?** The host mediates requests and the MCP server
   re-verifies the bearer plus current application authority. Vue state grants
   nothing.
7. **Invalid states?** Construction fails before creating the SDK App unless a
   browser and current Vue component instance own `onMounted`. The wrapper
   exposes one phase, one sanitized lifecycle error, two narrow host operations,
   and readonly shallow projections. The mutable SDK App, a Convex client, and
   tokens remain private.
8. **Persistent mechanism?** None. No table, cache, worker, registry, plugin,
   global singleton, or background job is added.
9. **Failure model?** Connection and structured-clone failures retire and close
   the App, move the lifecycle to `error`, and expose only a stable local
   code/message. Official operation results/errors stay caller-owned and do not
   change the lifecycle phase or error.
10. **Packed proof?** The subpath must be installed from the exact Vue tarball in
    production Vite Apps for both consumers before stabilization.

## Rejected surface

- Separate `useMcpToolInput`, `useMcpToolResult`, and `useMcpHostContext`
  composables: one App lifecycle does not justify provide/inject or multiple
  lookup APIs.
- `sendMessage`, resource, display, download, local-tool registration, raw
  protocol handlers, and a mutable `App`: neither proving consumer needs them,
  and exposing them would defeat lifecycle ownership.
- Configurable automatic resize: the exact SDK cannot retire the observer it
  creates, so the feature remains unavailable until upstream owns cleanup.
- An MCP App Vue plugin: each iframe root owns one local App; no application-wide
  runtime is needed.
- Automatic theme mutation: consumers may compose the official theme helpers;
  the lifecycle only exposes current context.
- Raw error causes, host messages, stacks, bridge transcripts, or rejected
  values in Vue state. The only lifecycle diagnostic is a stable local
  code/message pair.
- Direct Convex or Better Auth attachment inside the iframe.
- A host/sandbox implementation in the Vue package. Hosts own sandboxing; Better
  Convex tests it but does not become a general MCP host SDK.
- React compatibility, server registration wrappers, protocol-version adapters,
  or v1/v2 casts.

## Consequences

`P7-002` may add the optional entry with an exact Apps dependency without
changing the ordinary `better-convex-vue` dependency graph or main bundle.
`P7-003` proves lifecycle behavior before examples migrate. The entry remains
experimental while the exact SDK has no logger control: it logs protocol
payloads to the browser console. Better Convex's proof forbids credentials in
those payloads and checks credential sentinels across console output, but a
stable API still requires upstream logger suppression plus different-origin
and real-host evidence. If implementation requires more than this narrow
surface, stop and amend this decision with executed evidence rather than
adding convenience APIs.
