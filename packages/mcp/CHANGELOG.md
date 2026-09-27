# @lupinum/better-convex-mcp

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
