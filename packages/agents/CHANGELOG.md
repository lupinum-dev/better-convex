# @lupinum/better-convex-agents

## 0.1.0-rc.0

### Minor Changes

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `callTool` to `@lupinum/better-convex-agents/test`: it calls a tool in convex-test exactly as the MCP door does, and rejects with the tool's own error.
  Remove `testAuth`, `mcpClient` and `refs` from `./test`. `testAuth` faked the auth component, so app tests checked the fake instead of the real revocation.
  Migration: use `register`, `signInAs` and `grantMcp` from `@lupinum/better-convex-nuxt/better-auth/test`, and call tools with `callTool(t, tools, principal, name, input)`.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `@lupinum/better-convex-agents`, the renamed `@lupinum/better-convex-mcp`: `defineTools` turns operations of `@lupinum/better-convex-functions` into tools, with approvals, agent limits, an activity feed and housekeeping.
  `createMcpServer` (`/mcp`) publishes those tools to MCP hosts; a connection sees only the tools its scopes unlock.
  `handleMcpRequest` now also serves 2025-era clients (Claude, ChatGPT) statelessly, with JSON responses.
  Remove `defineMcpTool`, `registerMcpTool` and `runMcpTool`.
  Migration: install `@lupinum/better-convex-agents` and `@lupinum/better-convex-functions`, import the transport from `@lupinum/better-convex-agents/mcp`, and use `tools.runTool(name, operation)` instead of `runMcpTool`; see MIGRATING.md.

### Patch Changes

- [#179](https://github.com/lupinum-dev/better-convex/pull/179) [`5b43a1f`](https://github.com/lupinum-dev/better-convex/commit/5b43a1ffec2337476b1f287a4a8732ea6cb5e342) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the packaged agent documentation (`<package>/agent-docs`): it now starts with a task table and the rules agents most often get wrong, lists pages in navigation order, and its links work inside the package.

- [#203](https://github.com/lupinum-dev/better-convex/pull/203) [`09f38bd`](https://github.com/lupinum-dev/better-convex/commit/09f38bd1f1883de046b3de8b4ffa25cb33a05fe5) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the MCP Inspector example in "Connect ChatGPT and Claude" and in the packaged agent docs. Inspector requests `offline_access` by default, and the example client now allows it. Before, authorization failed with `invalid_scope`.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the `@modelcontextprotocol/server` peer to 2.2.0, the release that patches GHSA-6qxp-vccf-f47h in the MCP SDK.
  Migration: install `@modelcontextprotocol/server@2.2.0`.

- [#218](https://github.com/lupinum-dev/better-convex/pull/218) [`7e94263`](https://github.com/lupinum-dev/better-convex/commit/7e94263fb6a80d6c10f4773535ad3d3d4463453e) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix custom auth error messages bypassing the exposure list.
- Updated dependencies [[`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8)]:
  - @lupinum/better-convex-functions@0.1.0-rc.0

Before 0.1.0 this package was `@lupinum/better-convex-mcp`. Its history, up to
`1.0.0-rc.0`, is in the repository
[CHANGELOG.md](https://github.com/lupinum-dev/better-convex/blob/main/CHANGELOG.md),
under the `1.0.0-rc.0` release and the `mcp-v*` headings.
