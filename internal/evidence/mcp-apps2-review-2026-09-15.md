# MCP Apps 2.0.0 compatibility review

## Result and scope

The unchanged public `@lupinum/better-convex-mcp/vue` lifecycle passed an
isolated local consumer check with exact MCP Apps `2.0.0` on 2026-09-15.
This supports the explicit `1.7.5 || 2.0.0` optional peer range. It does not
claim compatibility with other Apps versions, every host, or new Apps 2
features outside the public composable.

This was a source-build compatibility check on macOS with Node `24.18.0`,
pnpm `11.21.0`, and Chromium through the repository's Playwright installation.
It did not create a package tarball, release artifact, or Linux certification.
No ChatGPT or Claude account or hosted deployment was used.

## Exact graph and source binding

The temporary consumer installed these exact versions with strict peer
checking and the repository's unchanged dependency-age policy. A second
frozen, offline install passed.

| Dependency                                     | Version  |
| ---------------------------------------------- | -------- |
| `@modelcontextprotocol/ext-apps`               | `2.0.0`  |
| `@modelcontextprotocol/client`                 | `2.0.0`  |
| `@modelcontextprotocol/core`                   | `2.0.0`  |
| `@modelcontextprotocol/server`                 | `2.0.0`  |
| `@modelcontextprotocol/sdk` optional companion | `1.30.0` |
| Vue                                            | `3.5.40` |
| Zod                                            | `4.4.3`  |

The MCP package manifest and already-built `dist` directory were copied into
the temporary consumer, then installed as a local directory dependency.
No active workspace dependency links or demo installation were changed.
The copied manifest omitted development scripts and development dependencies;
its public exports, runtime dependencies, optional peers, and package version
were preserved. Every runtime module in the browser App bundle resolved
inside the isolated consumer. The bundle consumed its installed MCP
`dist/vue.mjs`; an assertion rejected package-source fallback.

The working tree was based on
`cfb892ae9f514528e6e6fa85454bfdd84dc2b486`, with the pending release fixes.
SHA-256 digests bind the relevant unchanged lifecycle and inspected bytes:

| Input                          | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `packages/mcp/src/vue.ts`      | `5f35ae25b5aaf0dd880e9562f49a568c3c78142f888a88ee446459de46924233` |
| Installed `dist/vue.mjs`       | `1ed28d0ff9dd05e56d3b02562629729d1cbf8d17aa27ff236b5a2e2d71b36783` |
| Installed `dist/vue.d.mts`     | `e7ea125fa7134934d91cc2c1c26a5774268c961e6758136aae551b275241ad56` |
| Consumer lockfile              | `f7275d96b71b79f912bdb6f81c8abb866687577e56599fb7170ce8c12709ade7` |
| Redacted browser proof summary | `35742878e75400b338aa104d7e3833c18e82d38fddc21e85696f75ff17988351` |

The lockfile records these registry integrity values:

```text
@modelcontextprotocol/ext-apps@2.0.0
sha512-a6tXzFcIbIIdnqumQ7W8Oxd8W/KAPkAKYpoxpD9nDgxZ24ywgxG5pK/8G9W5pOFUygS7gWHQhPv8cwRB44/8yg==
@modelcontextprotocol/client@2.0.0
sha512-8f1OghQ2rjzIOfqgUCP+8GiUWqRs89njoWLNqAe8kWmDePv3s1fZXseej+QXemssEuuOvLLmLO/kqM3IQHtISw==
@modelcontextprotocol/core@2.0.0
sha512-pJCEwGG7Lfr/+PQp9ZTwKXNeO5wzbfKL7H3MYpCorM4oFBoQrdjnBgEoqG+RjhsvS1FKrDbKux+M1HhlnGWqcA==
```

## Checks performed

The consumer reused the public typing fixture from
`scripts/check-vue-mcp-app-consumer.mjs`, with strict TypeScript, browser DOM
types, bundler module resolution, and `skipLibCheck` as in the maintained
consumer gate. Public options, phase, error, host version, readonly diagnostics,
and the absence of a mutable raw SDK App compiled as expected.

The unchanged Notes Dashboard sources and builder were copied into the
consumer. The temporary builder set Vite's root to the consumer so Vue could
not resolve from the surrounding repository. Explicit entries selected the
installed MCP export and Apps 2.0.0 App/AppBridge exports.

`proveNotesDashboardBrowserBoundary` ran its existing real-browser assertions
against that build. Host-mediated requests used the isolated official client
2.0.0 and installed MCP server, pinned to protocol `2026-07-28`.

| Behavior                                          | Observed result                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Initial handshake and input during initialization | Passed; one initialization                                                                 |
| Partial input, repeated results, and cancellation | Passed                                                                                     |
| User-controlled HTML-shaped content               | Escaped as text; no attacker DOM or script execution                                       |
| Wrong-source bridge message                       | Rejected by the official bridge                                                            |
| Host theme change                                 | Reflected in the App                                                                       |
| Allowed tool request and structured result        | Passed through the real official client/server                                             |
| Cross-project and revoked fixture access          | Denied; no protected fixture result escaped                                                |
| Non-allowlisted write                             | Denied by the host; not forwarded to MCP                                                   |
| Missing link capability                           | Link control disabled                                                                      |
| Second mount with link capability                 | One host link request, with host denial handled                                            |
| Teardown and remount                              | One teardown response and one initialization for each mount                                |
| Cookie, bearer, client, and provider sentinels    | Absent from App HTML, DOM, messages, logs, and results under the existing proof assertions |

The App HTML was 289,041 bytes. The first mount forwarded exactly three
allowlisted MCP calls. The second mount forwarded no tool calls and one link
request. Both owned browser sessions and transports closed in finalizers.

## Reproduction and limits

Use the maintained `check-vue-mcp-app-consumer.mjs` typing, installed-export,
official-client, and browser-boundary procedure with the exact graph above.
For this local review, replace its tarball inputs with copies of the already
built package directory, copy the Notes Dashboard fixture into the isolated
consumer, and set that copied builder's Vite root to the consumer. This
distinction must remain explicit: a directory-copy check is not a packed
artifact certification.

The declared peer union must not be mistaken for a two-version CI matrix.
A dependency installer can choose one union member. The existing 1.7.5
checks and this explicit 2.0.0 review establish the two tested versions;
future changes to the public lifecycle should rerun each exact version.
The authorization denials above use controlled local fixture state, not
external identity-provider or real-host account lifecycle evidence.
