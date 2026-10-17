# @lupinum/better-convex-functions

## 0.1.0-rc.4

### Minor Changes

- [#268](https://github.com/lupinum-dev/better-convex/pull/268) [`249710c`](https://github.com/lupinum-dev/better-convex/commit/249710c71cfbfd1b60e8948ce25e3fb69ba5d17a) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change a call that names no tenant to need a role. `roleOf(ctx, user, null)` gives the role outside any tenant.
  
  Before, such a call skipped the role check, and only row rules held it: a function that touches no row, or only rows whose rule checks no role, ran for any signed-in person.
  `null` refuses the call unless its action is public. What every signed-in person may do is a role, for example `signedIn`. An app with one workspace returns the member's role and needs no role checks in handlers.
  A public function that no role allows, and that is not public, fails when it is built. A deleted ID and a foreign ID get the same `NOT_FOUND` message.
  Migration: `roleOf` receives `null` for a call that names no tenant. Return a role (for example `'signedIn'`, listing what every signed-in person may do) or `null`, and delete role checks in handlers or builder wrappers.

- [#268](https://github.com/lupinum-dev/better-convex/pull/268) [`249710c`](https://github.com/lupinum-dev/better-convex/commit/249710c71cfbfd1b60e8948ce25e3fb69ba5d17a) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add a public `action` builder, so work a person starts in the browser needs no raw Convex action
  
  Create it once: `export const { authorizeAction } = fns` and `export const action = fns.action(internal.functions.authorizeAction)`.
  Before the handler runs, `authorizeAction` checks the caller, the policy and the tenant the arguments name, like a public mutation, and takes the action's rate-limit token.
  The handler gets `ctx.actor`; `ctx.runQuery`, `runMutation`, `runAction` and `scheduler` reach internal operations as that actor.
  An action is not a tool, and agents cannot call it.

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
