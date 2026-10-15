# @lupinum/better-convex-functions

## 0.1.0-rc.3

### Minor Changes

- [#267](https://github.com/lupinum-dev/better-convex/pull/267) [`cd427dc`](https://github.com/lupinum-dev/better-convex/commit/cd427dcfb8e124f6d55bd20492c06c44e599618f) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add upload links for agents: `request_upload`, `uploadRoute` and `claimUpload`
  
  Turn them on with `defineTools(fns, modules, { functions, uploads: { scopes, types, maxBytes } })` and `http.route(uploadRoute(agents))`.
  An agent sends a file's bytes outside MCP with a one-time token; the route checks size and type from the first bytes.
  `claimUpload(ctx, uploadId, { types, maxBytes })` inside a mutation operation hands over the file only to the actor that sent it, once.
  `libraryTables` gains the `uploads` table; `housekeeping` and account deletion clean it up.

## 0.1.0-rc.2

No changes in this release.

## 0.1.0-rc.1

### Patch Changes

- [#251](https://github.com/lupinum-dev/better-convex/pull/251) [`aac1eae`](https://github.com/lupinum-dev/better-convex/commit/aac1eaecf94b3ba05b3b4907567ae974a72300a0) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the README: it now has an Agent setup section that points your coding agent at the documentation inside the installed package.

## 0.1.0-rc.0

### Minor Changes

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `@lupinum/better-convex-functions`: operations, policy, row rules and internal operations for Convex functions.
  `defineFunctions` checks the caller, the policy and every row a handler reads or writes.
  The `./test` entry finds functions that bypass it and counts the documents each call reads and writes.
