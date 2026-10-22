# @lupinum/better-convex-functions

## 0.1.0-rc.5

### Patch Changes

- [#299](https://github.com/lupinum-dev/better-convex/pull/299) [`1970336`](https://github.com/lupinum-dev/better-convex/commit/19703362092e79e75e4f54a38be1b2187cfa715c) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix work that an allowed agent tool scheduled failing with `AGENT_DISABLED` after the agent's turn moved on, its run ended or its MCP access token expired.
  
  Scheduled work is part of the call that scheduled it. It still checks the agent's grant, the person and their role, so turning the agent off or disconnecting the host stops it.

- [#306](https://github.com/lupinum-dev/better-convex/pull/306) [`e7c9f87`](https://github.com/lupinum-dev/better-convex/commit/e7c9f87510dc41d27dd665e738cfea18e6102e31) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change an agent's call that changes data and has no agent rule to wait for a person, and let `ctx.scheduler.cancel` cancel only the caller's own jobs.
  
  Before, a mutation, action or internal mutation without an entry in `definePolicy({ agents })` ran for an agent on its own. A query without an entry still runs. The tool catalog shows such a write tool with `approval: 'always'`.
  `ctx.scheduler.cancel` fails with `NOT_FOUND` for a job that another person or agent scheduled. An action cancels only the jobs it scheduled in the same call.
  Migration: give `'allow'` to each write action that agents may run on their own, also to an internal mutation that an allowed tool runs.

- [#299](https://github.com/lupinum-dev/better-convex/pull/299) [`1970336`](https://github.com/lupinum-dev/better-convex/commit/19703362092e79e75e4f54a38be1b2187cfa715c) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a scheduled follow-up of the same action taking a second rate-limit token.
  
  `ctx.scheduler.runAfter` and `runAt` pass on the buckets the call already paid, and an internal action passes them to the mutations it runs. A follow-up of another action or tenant still pays its own token. A chain that schedules itself again pays once per request.

- [#303](https://github.com/lupinum-dev/better-convex/pull/303) [`1aef2f1`](https://github.com/lupinum-dev/better-convex/commit/1aef2f1dc39a40d4b2da48e5449350f5f769536a) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a tool whose module is not passed to `defineTools` being left out of the tool list without a word.
  
  `launchProblems` now names each operation with a `tool` that no exported `defineTools` result collected, with the module, the export, the tool name and the fix.

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
