# @lupinum/better-convex-vue

## 1.0.0-rc.2

### Patch Changes

- [#179](https://github.com/lupinum-dev/better-convex/pull/179) [`5b43a1f`](https://github.com/lupinum-dev/better-convex/commit/5b43a1ffec2337476b1f287a4a8732ea6cb5e342) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the packaged agent documentation (`<package>/agent-docs`): it now starts with a task table and the rules agents most often get wrong, lists pages in navigation order, and its links work inside the package.

- [#185](https://github.com/lupinum-dev/better-convex/pull/185) [`a13f74b`](https://github.com/lupinum-dev/better-convex/commit/a13f74b7ff5d0991800e49dd652bc31a8e3a6021) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix server-rendered query data flashing empty or pending after hydration when auth is enabled.
  A page the server rendered anonymously now starts as confirmed anonymous, so the browser's first auth check no longer clears its data, and a query that already has a result for its arguments stays `success` while auth confirms. A session found after an anonymous render still clears the data and runs the query as that user.

- [#211](https://github.com/lupinum-dev/better-convex/pull/211) [`17a785a`](https://github.com/lupinum-dev/better-convex/commit/17a785a5826a538208dd836b578cd69632f2de45) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `useConvexAuth()` showing a user as signed in before Convex accepted the token.
  `status` now changes only after Convex accepts the session, uses `'pending'` instead of `'loading'`, and `pending` follows `status` as in every other composable. A client that keeps failing to start no longer retries in a loop, and a library authentication error keeps its code.

  Migration: replace `status === 'loading'` with `status === 'pending'`. To disable a button while a sign-in or sign-out runs, keep your own `ref` around the call; `pending` no longer covers it. Plain Vue auth adapters report `'pending'` instead of `'loading'`.

- [#181](https://github.com/lupinum-dev/better-convex/pull/181) [`0a2e17d`](https://github.com/lupinum-dev/better-convex/commit/0a2e17d37a95c1199bb765bf4638390d56b51598) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix errors without a cause: in development, an error that becomes `Unknown Convex error` is now logged once with its original cause.
  Production output and the public `ConvexCallError` stay the same.

- [#213](https://github.com/lupinum-dev/better-convex/pull/213) [`5e87683`](https://github.com/lupinum-dev/better-convex/commit/5e87683d5006a6567c4fd0da8584127951dbccee) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `useConvexOperation` to an experimental API: import it from `@lupinum/better-convex-nuxt/experimental` or `@lupinum/better-convex-vue/experimental`.

  Migration: add `import { useConvexOperation } from '@lupinum/better-convex-nuxt/experimental'`; Nuxt no longer auto-imports it.

- [#228](https://github.com/lupinum-dev/better-convex/pull/228) [`4647e8c`](https://github.com/lupinum-dev/better-convex/commit/4647e8c7dc1e8b0d53ba63bce39149df7c8373db) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the test kit to fail when a mutation passes an optimistic update and keep cached query values and errors scoped to their client.

- [#226](https://github.com/lupinum-dev/better-convex/pull/226) [`18ff1d4`](https://github.com/lupinum-dev/better-convex/commit/18ff1d4583e764224704d1d7c0a8d9b8d630d89b) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add experimental `keepAlive` to keep query subscriptions open for a while after the last component leaves, so going back shows data at once.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `auth.mcpAuthorization(ctx)`: the MCP door's resource, issuer, scopes and token verifier from the `oauth.mcp` profile in one call.
  Pass `auth` to `createMcpServer` from `@lupinum/better-convex-agents/mcp`, or spread the result into the `handleMcpRequest` options.

- [#203](https://github.com/lupinum-dev/better-convex/pull/203) [`09f38bd`](https://github.com/lupinum-dev/better-convex/commit/09f38bd1f1883de046b3de8b4ffa25cb33a05fe5) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the MCP Inspector example in "Connect ChatGPT and Claude" and in the packaged agent docs. Inspector requests `offline_access` by default, and the example client now allows it. Before, authorization failed with `invalid_scope`.

- [#214](https://github.com/lupinum-dev/better-convex/pull/214) [`719f58c`](https://github.com/lupinum-dev/better-convex/commit/719f58cfdc6be87884e6f6aa487f46e08caa6926) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix upload and operation arguments being read after the wait for authentication.
  `upload()` args and context and every `op.query`, `op.mutation` and `op.action` call now copy their arguments when called, with the same rules as `mutate()`. Write state publishes `status` last, a form can no longer be submitted twice from a `pending` watcher, and a form cancelled during validation returns `CANCELLED`.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Remove `auth.mcp`: `auth.mcpAuthorization(ctx)` is the one source of the MCP resource, issuer and supported scopes.
  `auth.oauthOperator.createPublicClient` binds a client to the `oauth.mcp` resource when you leave out `resource`.

  Migration: spread `auth.mcpAuthorization(ctx)` into the `handleMcpRequest` options instead of `auth.mcp.resource()`, `auth.mcp.issuer()` and `auth.mcp.scopesSupported()`, and drop `resource: { identifier: auth.mcp.resource().href, … }` from `createPublicClient`.

- [#218](https://github.com/lupinum-dev/better-convex/pull/218) [`7e94263`](https://github.com/lupinum-dev/better-convex/commit/7e94263fb6a80d6c10f4773535ad3d3d4463453e) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix invalid upload size limits being accepted.

- [#192](https://github.com/lupinum-dev/better-convex/pull/192) [`211fbdc`](https://github.com/lupinum-dev/better-convex/commit/211fbdc80267cfe12c9214672af1530961eb73df) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `useConvexOperation` showing `CANCELLED` as an error after `op.cancel()`. The state now returns to `'idle'`, as it does after `reset()` and a cancelled upload.

- [#221](https://github.com/lupinum-dev/better-convex/pull/221) [`71d983d`](https://github.com/lupinum-dev/better-convex/commit/71d983df4abe75ee55f126d2d4c8ffd14c78d153) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add experimental `insertAtTop` and `optimisticallyUpdateValueInPaginatedQuery` for optimistic updates to paginated lists.

- [#183](https://github.com/lupinum-dev/better-convex/pull/183) [`8f2a4a2`](https://github.com/lupinum-dev/better-convex/commit/8f2a4a2f33744b04b97e3a1b15c72e98a2355fcd) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a loading flash when a component mounts a query that is already live elsewhere on the page.
  The query now starts with the result the client already holds, in the same render, instead of showing `pending` for one frame.

- [#186](https://github.com/lupinum-dev/better-convex/pull/186) [`d1a4f20`](https://github.com/lupinum-dev/better-convex/commit/d1a4f20b6bd78798ed0e6d06238b0ca44db972cd) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Remove `refresh()` from `useConvexQuery` and `useConvexPaginatedQuery`; it never re-ran a live query.

  Migration: Delete `refresh()` calls. Convex re-runs queries when their data changes. Use `loadMore()` to retry a failed later page.

- [#200](https://github.com/lupinum-dev/better-convex/pull/200) [`4cad9d8`](https://github.com/lupinum-dev/better-convex/commit/4cad9d8f58f3582d846d91c41c2316776cf51bda) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the paginated query's `reset()` to `restart()`; it restarts the list.

  Migration: Rename `reset(` to `restart(` on results of `useConvexPaginatedQuery`.

- [#171](https://github.com/lupinum-dev/better-convex/pull/171) [`d84df98`](https://github.com/lupinum-dev/better-convex/commit/d84df9899bb4a2bfd7a71c09076f43095aa5806c) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix optimistic updates showing values that were never sent when a reactive object is passed to `mutate()`.

- [#184](https://github.com/lupinum-dev/better-convex/pull/184) [`55a90d6`](https://github.com/lupinum-dev/better-convex/commit/55a90d60cea9f3523b00f7593156ba75f102cc13) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `await useConvexQuery()` and `useConvexPaginatedQuery()` on the first load of an `ssr: false` page.
  The query now starts at once and the await waits for its first result. Before, it returned at once with `status: 'idle'` and no data, because Nuxt reports `isHydrating` on that render too.

- [#191](https://github.com/lupinum-dev/better-convex/pull/191) [`73df34d`](https://github.com/lupinum-dev/better-convex/commit/73df34d74442797b31e85e17e7df62381b0a2a4b) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a mutation, form submission or operation started before the first auth result failing with `IDENTITY_CHANGED` when that result finds no session. It now waits and runs as the anonymous visitor, and identity-owned state is kept.

- [#194](https://github.com/lupinum-dev/better-convex/pull/194) [`03a4279`](https://github.com/lupinum-dev/better-convex/commit/03a4279c6c51f6861d8f6ca929a0ca3b2f6f22cf) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the Convex client skipping its proactive token refresh. Two session tokens minted in the same second were identical, and Convex schedules a refresh only after it receives a new token, so the first update after the token expired needed a reconnect. Each token now has a unique `jti`.

  The client now keeps its first confirmed token until the scheduled refresh (Convex `initialAuthTokenReuse`). Before, it fetched a second token right after connecting, which cost one more token request per page load and re-ran every authenticated query.

- [#182](https://github.com/lupinum-dev/better-convex/pull/182) [`572cc15`](https://github.com/lupinum-dev/better-convex/commit/572cc15a825f67e81bed645d766a3e107a222d35) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `mutate()` and `run()` to accept a ref for each argument, like query arguments.
  The call reads the ref's value once, when you call it, and sends that value.

- [#212](https://github.com/lupinum-dev/better-convex/pull/212) [`4e33b64`](https://github.com/lupinum-dev/better-convex/commit/4e33b64edfa7f7c10a05a6b80fe0efc204342c10) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `upload()` to take one options object: `upload(file, { args, context })`.

  Migration: replace `upload(file, args, { context })` with `upload(file, { args, context })`, and `upload(file, {}, { context })` with `upload(file, { context })`.

## 1.0.0-rc.1

### Patch Changes

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `reactive(useConvexQuery(...))` and `reactive()` around every other composable: results are no longer frozen, so `reactive()` unwraps their refs.

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add refs as individual query arguments: `useConvexQuery(api.projects.get, { projectId })` with `projectId` from `toRefs(props)` now type-checks, also in `useConvexPaginatedQuery`.

## 1.0.0-rc.0

- First 1.0 release candidate, released together with
  `@lupinum/better-convex-nuxt` `1.0.0-rc.0`. The full notes are in the
  repository
  [CHANGELOG.md](https://github.com/lupinum-dev/better-convex/blob/main/CHANGELOG.md#v100-rc0).
