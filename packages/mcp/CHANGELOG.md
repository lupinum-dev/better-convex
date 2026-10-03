# @lupinum/better-convex-mcp

## 1.0.0-rc.1

### Patch Changes

- [#179](https://github.com/lupinum-dev/better-convex/pull/179) [`5b43a1f`](https://github.com/lupinum-dev/better-convex/commit/5b43a1ffec2337476b1f287a4a8732ea6cb5e342) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the packaged agent documentation (`<package>/agent-docs`): it now starts with a task table and the rules agents most often get wrong, lists pages in navigation order, and its links work inside the package.

## 1.0.0-rc.0

- First 1.0 release candidate. `@modelcontextprotocol/server` `2.1.0` is an
  exact peer dependency that the application installs.
- `configureServer` receives one `{ access, principal, server, tools }` object.
- Add `defineMcpTool`, `registerMcpTool`, `projectMcpToolError` and
  `exposeErrorCodes`, and `listMcpCatalog` from
  `@lupinum/better-convex-mcp/test`.
- Requests must send the `MCP-Protocol-Version` header.
- Migration: follow
  [Upgrade to 1.0](https://better-convex.lupinum.com/docs/operations/upgrade-to-1-0).

Earlier versions are listed under the `mcp-v*` headings in the repository
[CHANGELOG.md](https://github.com/lupinum-dev/better-convex/blob/main/CHANGELOG.md).
