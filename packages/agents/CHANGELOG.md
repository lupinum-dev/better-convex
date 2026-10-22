# @lupinum/better-convex-agents

## 0.1.0-rc.5

### Patch Changes

- [#306](https://github.com/lupinum-dev/better-convex/pull/306) [`e7c9f87`](https://github.com/lupinum-dev/better-convex/commit/e7c9f87510dc41d27dd665e738cfea18e6102e31) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change an agent's call that changes data and has no agent rule to wait for a person, and let `ctx.scheduler.cancel` cancel only the caller's own jobs.
  
  Before, a mutation, action or internal mutation without an entry in `definePolicy({ agents })` ran for an agent on its own. A query without an entry still runs. The tool catalog shows such a write tool with `approval: 'always'`.
  `ctx.scheduler.cancel` fails with `NOT_FOUND` for a job that another person or agent scheduled. An action cancels only the jobs it scheduled in the same call.
  Migration: give `'allow'` to each write action that agents may run on their own, also to an internal mutation that an allowed tool runs.

- [#303](https://github.com/lupinum-dev/better-convex/pull/303) [`1aef2f1`](https://github.com/lupinum-dev/better-convex/commit/1aef2f1dc39a40d4b2da48e5449350f5f769536a) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a tool whose module is not passed to `defineTools` being left out of the tool list without a word.
  
  `launchProblems` now names each operation with a `tool` that no exported `defineTools` result collected, with the module, the export, the tool name and the fix.
- Updated dependencies [[`1970336`](https://github.com/lupinum-dev/better-convex/commit/19703362092e79e75e4f54a38be1b2187cfa715c), [`e7c9f87`](https://github.com/lupinum-dev/better-convex/commit/e7c9f87510dc41d27dd665e738cfea18e6102e31), [`1970336`](https://github.com/lupinum-dev/better-convex/commit/19703362092e79e75e4f54a38be1b2187cfa715c), [`1aef2f1`](https://github.com/lupinum-dev/better-convex/commit/1aef2f1dc39a40d4b2da48e5449350f5f769536a)]:
  - @lupinum/better-convex-functions@0.1.0-rc.5

## 0.1.0-rc.4

### Patch Changes

- Updated dependencies [[`249710c`](https://github.com/lupinum-dev/better-convex/commit/249710c71cfbfd1b60e8948ce25e3fb69ba5d17a), [`249710c`](https://github.com/lupinum-dev/better-convex/commit/249710c71cfbfd1b60e8948ce25e3fb69ba5d17a)]:
  - @lupinum/better-convex-functions@0.1.0-rc.4

## 0.1.0-rc.3

### Minor Changes

- [#267](https://github.com/lupinum-dev/better-convex/pull/267) [`cd427dc`](https://github.com/lupinum-dev/better-convex/commit/cd427dcfb8e124f6d55bd20492c06c44e599618f) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add upload links for agents: `request_upload`, `uploadRoute` and `claimUpload`
  
  Turn them on with `defineTools(fns, modules, { functions, uploads: { scopes, types, maxBytes } })` and `http.route(uploadRoute(agents))`.
  An agent sends a file's bytes outside MCP with a one-time token; the route checks size and type from the first bytes.
  `claimUpload(ctx, uploadId, { types, maxBytes })` inside a mutation operation hands over the file only to the actor that sent it, once.
  `libraryTables` gains the `uploads` table; `housekeeping` and account deletion clean it up.

### Patch Changes

- Updated dependencies [[`cd427dc`](https://github.com/lupinum-dev/better-convex/commit/cd427dcfb8e124f6d55bd20492c06c44e599618f)]:
  - @lupinum/better-convex-functions@0.1.0-rc.3

## 0.1.0-rc.2

### Patch Changes

- [#257](https://github.com/lupinum-dev/better-convex/pull/257) [`f10f4b2`](https://github.com/lupinum-dev/better-convex/commit/f10f4b2861266df2a65173e4167773f51686c4a9) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the dependencies to convex-helpers 0.1.120, ohash 2.0.12 and the MCP SDK 2.3.1
- Updated dependencies []:
  - @lupinum/better-convex-functions@0.1.0-rc.2

## 0.1.0-rc.1

### Patch Changes

- [#251](https://github.com/lupinum-dev/better-convex/pull/251) [`aac1eae`](https://github.com/lupinum-dev/better-convex/commit/aac1eaecf94b3ba05b3b4907567ae974a72300a0) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the README: it now has an Agent setup section that points your coding agent at the documentation inside the installed package.
- Updated dependencies [[`aac1eae`](https://github.com/lupinum-dev/better-convex/commit/aac1eaecf94b3ba05b3b4907567ae974a72300a0)]:
  - @lupinum/better-convex-functions@0.1.0-rc.1

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
