# Changelog

## 1.0.0-rc.2

### Minor Changes

- [#220](https://github.com/lupinum-dev/better-convex/pull/220) [`7993e31`](https://github.com/lupinum-dev/better-convex/commit/7993e31554dbbe1855019ef52e07f288ee2b9570) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `siteOrigins` to `createBetterConvexAuth` so one Convex deployment serves sign-in for several Nuxt sites.
  The auth proxy signs its `auth.origin` with `BCN_AUTH_PROXY_IP_SECRET`; Convex runs Better Auth with that origin when it is `SITE_URL` or listed. A wrongly signed or unlisted origin fails.
  Migration: a Nuxt `auth.origin` that differs from the Convex `SITE_URL` now fails auth requests unless `siteOrigins` lists it. Set both to the same origin, or list it.

### Patch Changes

- [#179](https://github.com/lupinum-dev/better-convex/pull/179) [`5b43a1f`](https://github.com/lupinum-dev/better-convex/commit/5b43a1ffec2337476b1f287a4a8732ea6cb5e342) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the packaged agent documentation (`<package>/agent-docs`): it now starts with a task table and the rules agents most often get wrong, lists pages in navigation order, and its links work inside the package.

- [#216](https://github.com/lupinum-dev/better-convex/pull/216) [`509909e`](https://github.com/lupinum-dev/better-convex/commit/509909e90bf74f4a91e94453e4cc9a8fd44d75b4) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix stale rate-limit cleanup, revoked-session counts and test sign-in, legacy account fields, newest OAuth connections, renewal scope limits, incomplete auth initialization, and team browser-check signing keys.

  For local auth components, regenerate the schema and export `pruneRateLimits` from the component adapter.

- [#185](https://github.com/lupinum-dev/better-convex/pull/185) [`a13f74b`](https://github.com/lupinum-dev/better-convex/commit/a13f74b7ff5d0991800e49dd652bc31a8e3a6021) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix server-rendered query data flashing empty or pending after hydration when auth is enabled.
  A page the server rendered anonymously now starts as confirmed anonymous, so the browser's first auth check no longer clears its data, and a query that already has a result for its arguments stays `success` while auth confirms. A session found after an anonymous render still clears the data and runs the query as that user.

- [#211](https://github.com/lupinum-dev/better-convex/pull/211) [`17a785a`](https://github.com/lupinum-dev/better-convex/commit/17a785a5826a538208dd836b578cd69632f2de45) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `useConvexAuth()` showing a user as signed in before Convex accepted the token.
  `status` now changes only after Convex accepts the session, uses `'pending'` instead of `'loading'`, and `pending` follows `status` as in every other composable. A client that keeps failing to start no longer retries in a loop, and a library authentication error keeps its code.

  Migration: replace `status === 'loading'` with `status === 'pending'`. To disable a button while a sign-in or sign-out runs, keep your own `ref` around the call; `pending` no longer covers it. Plain Vue auth adapters report `'pending'` instead of `'loading'`.

- [#234](https://github.com/lupinum-dev/better-convex/pull/234) [`6fc997d`](https://github.com/lupinum-dev/better-convex/commit/6fc997d8d463e6ff89cc66b37b50497378d60baf) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `beforeUserCreate`: the pending user no longer claims an `id` it never has, and a hook that throws or returns an invalid identity is now logged as `AUTH_USER_CREATE_REJECTED`. The docs now say that a rejected sign-up gets Better Auth's generic sign-up response, so the browser cannot tell who may sign up.

- [#223](https://github.com/lupinum-dev/better-convex/pull/223) [`c8847b6`](https://github.com/lupinum-dev/better-convex/commit/c8847b6bb1b0d6eb2306f44542bf418da2e4ce9e) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `convex logs` and `convex data` to the `better-convex convex` runner, and `--yes` and `--site-url` to `better-convex init`.
  `init` also reads every piped answer now; before, answers after the first were lost.

- [#215](https://github.com/lupinum-dev/better-convex/pull/215) [`bbab1b6`](https://github.com/lupinum-dev/better-convex/commit/bbab1b618aa340ae82e337f67a1662788cb823fe) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a deploy-time `NUXT_PUBLIC_CONVEX_URL` keeping the build's Convex site URL, which sent auth requests to a different deployment than the WebSocket.
  The module now stores only an explicit `siteUrl` and derives it from the effective URL at runtime. Runtime config is normalized once per config object instead of on every read, and an environment override that disables `convex.auth` in an auth build now fails with a message that names the cause.

- [#181](https://github.com/lupinum-dev/better-convex/pull/181) [`0a2e17d`](https://github.com/lupinum-dev/better-convex/commit/0a2e17d37a95c1199bb765bf4638390d56b51598) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix errors without a cause: in development, an error that becomes `Unknown Convex error` is now logged once with its original cause.
  Production output and the public `ConvexCallError` stay the same.

- [#213](https://github.com/lupinum-dev/better-convex/pull/213) [`5e87683`](https://github.com/lupinum-dev/better-convex/commit/5e87683d5006a6567c4fd0da8584127951dbccee) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `useConvexOperation` to an experimental API: import it from `@lupinum/better-convex-nuxt/experimental` or `@lupinum/better-convex-vue/experimental`.

  Migration: add `import { useConvexOperation } from '@lupinum/better-convex-nuxt/experimental'`; Nuxt no longer auto-imports it.

- [#176](https://github.com/lupinum-dev/better-convex/pull/176) [`b6b7815`](https://github.com/lupinum-dev/better-convex/commit/b6b7815aad6c8c8c9785d84eb7b62c99099831ba) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `better-convex --help` and other CLI commands crashing when the optional Better Auth packages are not installed.

- [#219](https://github.com/lupinum-dev/better-convex/pull/219) [`85dd37f`](https://github.com/lupinum-dev/better-convex/commit/85dd37f905d10a5b68087d75a49d95411b2033e4) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix DevTools showing no queries after a user change and an outdated token expiry.

  Local auth components: regenerate the schema (metadata no longer has `selectable` and `required`).

- [#201](https://github.com/lupinum-dev/better-convex/pull/201) [`45863eb`](https://github.com/lupinum-dev/better-convex/commit/45863eb65b6a422cc725513473ae65faf9d4f6aa) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change session reads (`GET /api/auth/get-session`) to skip the database rate limiter. They run on every page load and reconnect, and the counter cost one Convex write each; a missing or forged session cookie still fails before any database read.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `grantMcp(t, authId, scopes)` to `better-auth/test`: it gives a person a live MCP grant in `convex-test` and returns the principal that tools receive. It shares the user and session with `signInAs`, in either order.

  `signInAs` and `grantMcp` now refuse to run outside a test runner (`AUTH_TEST_RUNNER_REQUIRED` unless `VITEST` is set or `NODE_ENV` is `test`), so a wrapper deployed by mistake cannot create sessions or grants.

- [#224](https://github.com/lupinum-dev/better-convex/pull/224) [`c182783`](https://github.com/lupinum-dev/better-convex/commit/c1827834a263f27d872ee1f911928a6a6813c623) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add experimental guest sessions through Better Auth's anonymous plugin.

- [#228](https://github.com/lupinum-dev/better-convex/pull/228) [`4647e8c`](https://github.com/lupinum-dev/better-convex/commit/4647e8c7dc1e8b0d53ba63bce39149df7c8373db) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the test kit to fail when a mutation passes an optimistic update and keep cached query values and errors scoped to their client.

- [#197](https://github.com/lupinum-dev/better-convex/pull/197) [`7797ec6`](https://github.com/lupinum-dev/better-convex/commit/7797ec6d4b4e9d89256c26ffab5dcbf48856c99f) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `better-convex init` setting `SITE_URL` only in Convex. It now also writes it to `.env.local` when the file has none, so `convex.auth.origin` matches on ports other than 3000. An existing value is kept and offered as the default.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix declaration emit for apps that export the functions of `jwksOperatorFunctions()`: `./better-auth/server` now exports `SigningKeyRotationMetadata`, the type they return.

- [#226](https://github.com/lupinum-dev/better-convex/pull/226) [`18ff1d4`](https://github.com/lupinum-dev/better-convex/commit/18ff1d4583e764224704d1d7c0a8d9b8d630d89b) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add experimental `keepAlive` to keep query subscriptions open for a while after the last component leaves, so going back shows data at once.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `allowExpiredToken` to `auth.requireMcpPrincipal`: it skips only the access token's own expiry, so work a person approves after the agent's 10-minute token expired can still run. The session, client, resource and consent must still be live.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `auth.mcpAuthorization(ctx)`: the MCP door's resource, issuer, scopes and token verifier from the `oauth.mcp` profile in one call.
  Pass `auth` to `createMcpServer` from `@lupinum/better-convex-agents/mcp`, or spread the result into the `handleMcpRequest` options.

- [#203](https://github.com/lupinum-dev/better-convex/pull/203) [`09f38bd`](https://github.com/lupinum-dev/better-convex/commit/09f38bd1f1883de046b3de8b4ffa25cb33a05fe5) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the MCP Inspector example in "Connect ChatGPT and Claude" and in the packaged agent docs. Inspector requests `offline_access` by default, and the example client now allows it. Before, authorization failed with `invalid_scope`.

- [#196](https://github.com/lupinum-dev/better-convex/pull/196) [`588e512`](https://github.com/lupinum-dev/better-convex/commit/588e51272e3a3dae8f1ae4f6b8da22f2d8eb3fed) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a missing Convex URL giving no hint. The build now warns, and the browser logs which environment variable to set, instead of only failing later with "plugin is not installed".

- [#217](https://github.com/lupinum-dev/better-convex/pull/217) [`13dd5af`](https://github.com/lupinum-dev/better-convex/commit/13dd5afa5866e5854e837bbf18ec22ad78951992) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `client.connect: 'on-demand'` and `useConvexActivation()` to start the browser runtime only when a page needs it.
  Public pages then load no Convex or Better Auth client and open no WebSocket. `activate()` starts it; the auth route middleware starts it for pages with `convexAuth` metadata.

- [#214](https://github.com/lupinum-dev/better-convex/pull/214) [`719f58c`](https://github.com/lupinum-dev/better-convex/commit/719f58cfdc6be87884e6f6aa487f46e08caa6926) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix upload and operation arguments being read after the wait for authentication.
  `upload()` args and context and every `op.query`, `op.mutation` and `op.action` call now copy their arguments when called, with the same rules as `mutate()`. Write state publishes `status` last, a form can no longer be submitted twice from a `pending` watcher, and a form cancelled during validation returns `CANCELLED`.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Remove `auth.mcp`: `auth.mcpAuthorization(ctx)` is the one source of the MCP resource, issuer and supported scopes.
  `auth.oauthOperator.createPublicClient` binds a client to the `oauth.mcp` resource when you leave out `resource`.

  Migration: spread `auth.mcpAuthorization(ctx)` into the `handleMcpRequest` options instead of `auth.mcp.resource()`, `auth.mcp.issuer()` and `auth.mcp.scopesSupported()`, and drop `resource: { identifier: auth.mcp.resource().href, … }` from `createPublicClient`.

- [#218](https://github.com/lupinum-dev/better-convex/pull/218) [`7e94263`](https://github.com/lupinum-dev/better-convex/commit/7e94263fb6a80d6c10f4773535ad3d3d4463453e) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix shared auth rules, OAuth redirect checks, environment values and proxy diagnostics.

- [#221](https://github.com/lupinum-dev/better-convex/pull/221) [`71d983d`](https://github.com/lupinum-dev/better-convex/commit/71d983df4abe75ee55f126d2d4c8ffd14c78d153) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add experimental `insertAtTop` and `optimisticallyUpdateValueInPaginatedQuery` for optimistic updates to paginated lists.

- [#193](https://github.com/lupinum-dev/better-convex/pull/193) [`c453c58`](https://github.com/lupinum-dev/better-convex/commit/c453c58a8cae09cfc566d32b140665af3bbb50c3) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a missing or too short `BCN_AUTH_PROXY_IP_SECRET` being reported as "Auth proxy could not reach the configured Convex auth server". The auth proxy now rejects with code `BCN_AUTH_PROXY_IP_SECRET_INVALID` before contacting Convex.

- [#206](https://github.com/lupinum-dev/better-convex/pull/206) [`81b2dd2`](https://github.com/lupinum-dev/better-convex/commit/81b2dd278902c36442f1ca6e5ebd3c03bd949ef2) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `/api/auth/jwks` and the OAuth authorization-server metadata answering 403 in a browser. The proxy rejected every request that carried a cookie, but browsers attach cookies to every same-origin visit: the signed-in session, or a platform cookie such as Vercel's. These public routes now ignore cookies and never forward them. They still reject `Authorization`, `DPoP` and `Proxy-Authorization`.

- [#243](https://github.com/lupinum-dev/better-convex/pull/243) [`8b29312`](https://github.com/lupinum-dev/better-convex/commit/8b29312ad11c3439be6af9b249fc4bdc6ba74cb1) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `useConvexAuth().ready()` returning `'pending'` during a sign-in while `status` still showed the previous value. `ready()` now returns the same status as `useConvexAuth().status`.

- [#183](https://github.com/lupinum-dev/better-convex/pull/183) [`8f2a4a2`](https://github.com/lupinum-dev/better-convex/commit/8f2a4a2f33744b04b97e3a1b15c72e98a2355fcd) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix a loading flash when a component mounts a query that is already live elsewhere on the page.
  The query now starts with the result the client already holds, in the same render, instead of showing `pending` for one frame.

- [#186](https://github.com/lupinum-dev/better-convex/pull/186) [`d1a4f20`](https://github.com/lupinum-dev/better-convex/commit/d1a4f20b6bd78798ed0e6d06238b0ca44db972cd) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Remove `refresh()` from `useConvexQuery` and `useConvexPaginatedQuery`; it never re-ran a live query.

  Migration: Delete `refresh()` calls. Convex re-runs queries when their data changes. Use `loadMore()` to retry a failed later page.

- [#200](https://github.com/lupinum-dev/better-convex/pull/200) [`4cad9d8`](https://github.com/lupinum-dev/better-convex/commit/4cad9d8f58f3582d846d91c41c2316776cf51bda) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the paginated query's `reset()` to `restart()`; it restarts the list.

  Migration: Rename `reset(` to `restart(` on results of `useConvexPaginatedQuery`.

- [#190](https://github.com/lupinum-dev/better-convex/pull/190) [`fe86e5c`](https://github.com/lupinum-dev/better-convex/commit/fe86e5c7bbf8a0eaebf696a53bb1252c128c213c) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `useConvexAuth()` reporting `status: 'error'` for a moment during a normal sign-out. A session the server ended is now reported as signed out once Better Auth confirms it; a session Better Auth still holds stays an authentication error.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix signed-in users losing their Convex auth when Better Auth extends their session.
  The token route now issues a token while it renews the session the request presented, and an SSR page or Nitro helper passes the renewed session cookie on to the browser, so the cookie keeps the stored expiry. A token response without a usable lifetime now signs the browser out instead of reusing the previous token.

- [#171](https://github.com/lupinum-dev/better-convex/pull/171) [`d84df98`](https://github.com/lupinum-dev/better-convex/commit/d84df9899bb4a2bfd7a71c09076f43095aa5806c) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix optimistic updates showing values that were never sent when a reactive object is passed to `mutate()`.

- [#184](https://github.com/lupinum-dev/better-convex/pull/184) [`55a90d6`](https://github.com/lupinum-dev/better-convex/commit/55a90d60cea9f3523b00f7593156ba75f102cc13) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `await useConvexQuery()` and `useConvexPaginatedQuery()` on the first load of an `ssr: false` page.
  The query now starts at once and the await waits for its first result. Before, it returned at once with `status: 'idle'` and no data, because Nuxt reports `isHydrating` on that render too.

- [#217](https://github.com/lupinum-dev/better-convex/pull/217) [`13dd5af`](https://github.com/lupinum-dev/better-convex/commit/13dd5afa5866e5854e837bbf18ec22ad78951992) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add `auth.ssr` and the `convex: { ssrAuth }` route rule to render pages without the session.
  Such pages ignore session cookies on the server, call no token exchange, and get no `Vary: Cookie` or `private` header, so a shared cache or ISR can store them.

- [#188](https://github.com/lupinum-dev/better-convex/pull/188) [`a6d9c5f`](https://github.com/lupinum-dev/better-convex/commit/a6d9c5fa34028f4f0d03be6cf7b192862125e32d) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix one Convex call per component during SSR when several components request the same query and arguments at the same time; they now share one call.

- [#189](https://github.com/lupinum-dev/better-convex/pull/189) [`4496521`](https://github.com/lupinum-dev/better-convex/commit/4496521a88f1939cd791c259dc9e0bad598877ec) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the signed-in user's Convex token appearing in the SSR page payload. The server keeps it for its own queries; the browser already fetched its own token.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `createBetterConvexTestAuth` from `better-auth/test` to refuse to run outside a test runner (`AUTH_TEST_RUNNER_REQUIRED` unless `VITEST` is set or `NODE_ENV` is `test`), like `signInAs` and `grantMcp`. Before, a local development backend on `localhost` passed its loopback check and installed Better Auth's test helpers.

  Tests: this change can make a wrong app test fail, for example a script that calls `createBetterConvexTestAuth` outside Vitest. Run it under your test runner. A change to a test entry that only makes a wrong test fail ships in a normal release with a line like this one.

- [#248](https://github.com/lupinum-dev/better-convex/pull/248) [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the `better-auth/test` helpers after a revoke or an expiry. `grantMcp` gives
  a consent it makes again a fresh ID, so a principal from before the revoke stays
  refused, as after a real reconnect. `signInAs` no longer reuses an expired
  session; it signs in with a fresh one.

- [#207](https://github.com/lupinum-dev/better-convex/pull/207) [`f5c0753`](https://github.com/lupinum-dev/better-convex/commit/f5c0753bc5c354f536055b5c920cdcf1163d131d) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix signed-in users with a fast system clock losing Convex auth. When the browser's clock ran about 15 minutes or more ahead, every fresh session token looked expired, so the page dropped from signed in to an auth error after hydration and its queries failed. A fetched token is now judged by its own lifetime (`exp` minus `iat`); Convex already corrects for clock differences.

- [#194](https://github.com/lupinum-dev/better-convex/pull/194) [`03a4279`](https://github.com/lupinum-dev/better-convex/commit/03a4279c6c51f6861d8f6ca929a0ca3b2f6f22cf) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix the Convex client skipping its proactive token refresh. Two session tokens minted in the same second were identical, and Convex schedules a refresh only after it receives a new token, so the first update after the token expired needed a reconnect. Each token now has a unique `jti`.

  The client now keeps its first confirmed token until the scheduled refresh (Convex `initialAuthTokenReuse`). Before, it fetched a second token right after connecting, which cost one more token request per page load and re-ran every authenticated query.

- [#182](https://github.com/lupinum-dev/better-convex/pull/182) [`572cc15`](https://github.com/lupinum-dev/better-convex/commit/572cc15a825f67e81bed645d766a3e107a222d35) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `mutate()` and `run()` to accept a ref for each argument, like query arguments.
  The call reads the ref's value once, when you call it, and sends that value.

- [#212](https://github.com/lupinum-dev/better-convex/pull/212) [`4e33b64`](https://github.com/lupinum-dev/better-convex/commit/4e33b64edfa7f7c10a05a6b80fe0efc204342c10) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change `upload()` to take one options object: `upload(file, { args, context })`.

  Migration: replace `upload(file, args, { context })` with `upload(file, { args, context })`, and `upload(file, {}, { context })` with `upload(file, { context })`.

- Updated dependencies [[`5b43a1f`](https://github.com/lupinum-dev/better-convex/commit/5b43a1ffec2337476b1f287a4a8732ea6cb5e342), [`a13f74b`](https://github.com/lupinum-dev/better-convex/commit/a13f74b7ff5d0991800e49dd652bc31a8e3a6021), [`17a785a`](https://github.com/lupinum-dev/better-convex/commit/17a785a5826a538208dd836b578cd69632f2de45), [`0a2e17d`](https://github.com/lupinum-dev/better-convex/commit/0a2e17d37a95c1199bb765bf4638390d56b51598), [`5e87683`](https://github.com/lupinum-dev/better-convex/commit/5e87683d5006a6567c4fd0da8584127951dbccee), [`4647e8c`](https://github.com/lupinum-dev/better-convex/commit/4647e8c7dc1e8b0d53ba63bce39149df7c8373db), [`18ff1d4`](https://github.com/lupinum-dev/better-convex/commit/18ff1d4583e764224704d1d7c0a8d9b8d630d89b), [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8), [`09f38bd`](https://github.com/lupinum-dev/better-convex/commit/09f38bd1f1883de046b3de8b4ffa25cb33a05fe5), [`719f58c`](https://github.com/lupinum-dev/better-convex/commit/719f58cfdc6be87884e6f6aa487f46e08caa6926), [`bb6188a`](https://github.com/lupinum-dev/better-convex/commit/bb6188a146a2003631b5acfa612242b76517a0a8), [`7e94263`](https://github.com/lupinum-dev/better-convex/commit/7e94263fb6a80d6c10f4773535ad3d3d4463453e), [`211fbdc`](https://github.com/lupinum-dev/better-convex/commit/211fbdc80267cfe12c9214672af1530961eb73df), [`71d983d`](https://github.com/lupinum-dev/better-convex/commit/71d983df4abe75ee55f126d2d4c8ffd14c78d153), [`8f2a4a2`](https://github.com/lupinum-dev/better-convex/commit/8f2a4a2f33744b04b97e3a1b15c72e98a2355fcd), [`d1a4f20`](https://github.com/lupinum-dev/better-convex/commit/d1a4f20b6bd78798ed0e6d06238b0ca44db972cd), [`4cad9d8`](https://github.com/lupinum-dev/better-convex/commit/4cad9d8f58f3582d846d91c41c2316776cf51bda), [`d84df98`](https://github.com/lupinum-dev/better-convex/commit/d84df9899bb4a2bfd7a71c09076f43095aa5806c), [`55a90d6`](https://github.com/lupinum-dev/better-convex/commit/55a90d60cea9f3523b00f7593156ba75f102cc13), [`73df34d`](https://github.com/lupinum-dev/better-convex/commit/73df34d74442797b31e85e17e7df62381b0a2a4b), [`03a4279`](https://github.com/lupinum-dev/better-convex/commit/03a4279c6c51f6861d8f6ca929a0ca3b2f6f22cf), [`572cc15`](https://github.com/lupinum-dev/better-convex/commit/572cc15a825f67e81bed645d766a3e107a222d35), [`4e33b64`](https://github.com/lupinum-dev/better-convex/commit/4e33b64edfa7f7c10a05a6b80fe0efc204342c10)]:
  - @lupinum/better-convex-vue@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `reactive(useConvexQuery(...))` and `reactive()` around every other composable: results are no longer frozen, so `reactive()` unwraps their refs.

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add refs as individual query arguments: `useConvexQuery(api.projects.get, { projectId })` with `projectId` from `toRefs(props)` now type-checks, also in `useConvexPaginatedQuery`.
- Updated dependencies [[`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef), [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef)]:
  - @lupinum/better-convex-vue@1.0.0-rc.1

## v1.0.0-rc.0

- First 1.0 release candidate of `@lupinum/better-convex-nuxt` and
  `@lupinum/better-convex-vue`. It breaks the 1.0 beta API on purpose and has no
  compatibility layer; follow
  [Upgrade to 1.0](https://better-convex.lupinum.com/docs/operations/upgrade-to-1-0)
  or the short checklist in `MIGRATING.md`.
- Remove the workforce authentication profile, the beta.3 user migration,
  `@lupinum/better-convex-mcp/vue` (`useMcpApp`), `oauthPopupClient()`,
  `verifyOAuthBearerToken`, and `createWorkforceAuthSchemaOptions`.
- Require Better Auth, `@better-auth/core`, and `@better-auth/oauth-provider`
  `1.7.6` for every application with auth. The auth component `account` table
  is keyed by `(providerId, accountId)`. Existing beta account rows are
  preserved: the retired `issuer` stays as an optional column that the adapter
  never reads or writes, and `findAccountKeyCollisions` reports rows that share
  a `(providerId, accountId)` key. The schema push accepts every beta row
  without export, import, or manual clearing. Beta OAuth refresh tokens have no
  consent binding: they stay stored but are answered with `invalid_grant`, so
  MCP hosts and other OAuth clients sign in again. The repository's
  integration suite proves the 1.0.0-beta.7 upgrade on a pinned local Convex
  backend.
- `useConvexMutation` returns `{ mutate, data, status, pending, error, reset }`
  and `useConvexAction` returns `{ run, ... }`. `useConvexForm` rejects a
  concurrent submit with `SUBMIT_IN_PROGRESS`, and never sends a submission
  that an identity change (`IDENTITY_CHANGED`), `reset()`, or disposal
  (`CANCELLED`) retired while it was still validating.
- Pagination matches Convex `usePaginatedQuery`: `canLoadMore`, `isLoadingMore`,
  and `isExhausted` replace the public `pageStatus` and `cursor`; `loadMore()`
  returns a promise that never rejects, and a failed later page keeps the loaded
  items. The server-rendered first page is dropped once live data arrives and on
  every restart, so an invalid cursor or `reset()` never shows it again.
- `ConvexCallError` keeps the message written by your Convex function, carries
  `functionName` and a stable library `code`, and `isConvexCallError(error, code?)`
  checks it. Browser errors record `outcome` (`not-sent` or `unknown`) from the
  real request lifecycle. File upload moves into the Vue package with
  `CANCELLED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, and
  `UPLOAD_IN_PROGRESS` codes, and runs prepare, upload, and an optional
  `complete` step as one workflow for the signed-in user: `url` selects the URL
  from an object prepare result, `upload()` resolves with
  `{ storageId, prepared, completed }`, and errors carry `phase`.
  `upload(file, args, { context })` passes a per-call context, captured when
  `upload()` is called, to `url` and `complete` as `ctx.context`; its type is
  inferred from the `complete`/`url` annotation and then required.
- Add `useConvexOperation(work)`: several queries, mutations, actions, and
  uploads that run for the user who started them, with `run`, `data`, `status`,
  `pending`, `error`, and `reset` like `useConvexAction`. A step is checked
  immediately before it is sent, every later step stops after an identity
  change, and the state returns to `idle`. Callables, `useConvexForm`, and
  uploads use the same check; `reset()` on a callable stops a call that was not
  sent yet. `op.upload()` accepts `maxSize` and `allowedTypes` and rejects
  with `FILE_TOO_LARGE` / `FILE_TYPE_NOT_ALLOWED` (`outcome: 'not-sent'`)
  before any request.
- The component-test runtime runs the real composables against an in-memory
  Convex connection, from `@lupinum/better-convex-nuxt/test` and the new
  `@lupinum/better-convex-vue/test`. The Nuxt `composables` map is removed.
  `ConvexFormError` is exported from `@lupinum/better-convex-nuxt/errors` and
  `@lupinum/better-convex-vue/errors`.
- `useConvexAuth().client` is never `null`; queries with `server: false` render
  `idle` during SSR and hydration; queries expose `blockedBy`.
- `createBetterConvexAuth` is the only way to build auth. `auth.getUser`,
  `auth.requireUser` (code `UNAUTHENTICATED`), `auth.getAuth`, and
  `auth.sessionHttpAction` replace `auth.authComponent`; `convexAuth`,
  `createAuthComponent`, `createConvexAuthRateLimitStorage`, and
  `requireWritableAuthCtx` are no longer exported.
- One `email(ctx, message)` hook replaces the per-feature email callbacks, and
  password reset is opt-in. Session lifetimes, the cookie cache, and trusted
  account-linking providers are bounded. Session tokens carry only the library
  claims by default; add profile claims such as `name` and `email` with
  `defineSessionClaims`.
- Integrated-client calls to `/organization/get-full-organization` and
  `/account-info` reconcile the session, because Better Auth can change the
  active organization or the account cookie there.
- The local auth adapter exports `expireSession`, `oauthLiveAccess`, and
  `pruneSigningKeys` instead of `assertProfile` and the workforce functions.
  `jwksOperatorFunctions()` adds `pruneSigningKeys`.
- Add guest-only routes, `useConvexAuthReturnTo()`, `normalizeLocalRedirectPath()`,
  the `convex.auth.routes` and `convex.auth.defaultQueryAuth` defaults, the
  `convex.client` and `convex.server` options, and `getConvexUser`,
  `requireConvexUser`, and `toConvexH3Error` for Nitro handlers. `signInAs`
  ships from `@lupinum/better-convex-nuxt/better-auth/test`.
- The Convex MCP side adds the `oauth.mcp` profile with ChatGPT and Claude host
  presets, `auth.createMcpAccessVerifier(ctx)`, `mcpPrincipalValidator`,
  `auth.requireMcpPrincipal(ctx, principal, { scope })`,
  `auth.oauthConnections`, and `auth.oauthOperator.setClientDisabled`. One component
  query checks live MCP access, and the verifier reads signing keys from the
  component, so the `jwksUrl` option is gone. `createBetterAuthMcpAccessVerifier`,
  `auth.validateOAuthAccess`, and the `OAuthLiveAccess` type are removed; use
  `auth.createMcpAccessVerifier(ctx)` and `auth.requireMcpPrincipal`. Every
  OAuth access token, with renewal on or off, is bound to the consent that
  issued it, and disabling an OAuth resource rejects tokens already issued.
- Remove the `/api/_better-convex-nuxt/release-fingerprint` route and the
  `x-bcn-runtime-fingerprint` header on auth responses that beta release builds
  added. They only served the retired release gate.
- `@lupinum/better-convex-mcp` `1.0.0-rc.0` ships in the same release and keeps
  its own version and `mcp-v` tags (see `packages/mcp/CHANGELOG.md`). It
  declares `@modelcontextprotocol/server` `2.1.0` as an exact peer
  dependency that the application installs, passes one
  `{ access, principal, server, tools }` object to `configureServer`, adds
  `defineMcpTool`, `registerMcpTool`, `projectMcpToolError`, `exposeErrorCodes`,
  and `listMcpCatalog` from `/test`, and requires the `MCP-Protocol-Version`
  header.

## mcp-v1.0.0-beta.2

- Ship version-matched `agent-docs` guidance with the MCP package so coding
  agents can follow the installed contract instead of stale web documentation.
- Add package-owned onboarding and a complete exact MCP Apps install command
  without changing transport, authorization, or runtime behavior.

## v1.0.0-beta.7

- Ship version-matched `agent-docs` exports with each Vue and Nuxt package so
  coding agents can follow the installed contract instead of stale web docs.
- Add concise package-owned onboarding guidance without changing application
  authorization, runtime ownership, or installation behavior.

## v1.0.0-beta.6

- Preserve populated beta.3 Better Auth user IDs, accounts, passwords, and
  application identity references during the session-generation schema cutover.
- Provide a bounded user-only migration operator that requires legacy sessions
  to be invalidated and each operator to sign in again.

## v1.0.0-beta.5

- Make Better Auth rate-limit consumption one atomic Convex mutation so
  simultaneous first requests share one counter instead of failing during
  cold-start contention.
- Retry only final uncommitted Convex contention failures with a fixed bound,
  while preserving exact quotas, retry metadata, and independent client keys.

## v1.0.0-beta.4

- Revoke every earlier session after password reset with atomic generation
  invalidation, including accounts with more than the bounded bulk-delete limit.
- Require a current persisted session before approving destructive MCP starter
  operations, instead of trusting a still-valid session JWT alone.
- Bind development initialization to one inspected Convex authority and reject
  production or changed deployment credentials before provisioning.

## v1.0.0-beta.3

- Add an opt-in workforce assurance baseline for business applications with
  verified email, bounded sessions, TOTP, recovery codes, enrollment and
  revocation controls, and replay-safe security operations.
- Add typed Better Auth email hooks for verification, password reset, and
  invitations while keeping delivery in application-owned Convex actions.
- Preserve request-bound authentication continuity across browser, Nuxt, and
  Convex boundaries without exposing credentials to client state or logs.
- Centralize workforce adapter policy so transport handlers remain thin and
  security rules have one source of truth.

## v1.0.0-beta.2

- Prevent the OAuth client deletion operator from exposing a raw
  application-owned profile resolver failure.
- Recreate missing Better Auth user projections from the current update,
  reject ambiguous duplicate rows with a fixed internal error, and leave
  duplicate repair to application-owned migrations.

## mcp-v1.0.0-beta.1

- Release `@lupinum/better-convex-mcp` on its independent 1.0 beta line while
  preserving the coupled Vue/Nuxt version and release history.
- Consolidate MCP server operation on the `better-convex` command with
  provider-neutral request handling, OAuth resource verification, live access
  checks, and sanitized tool-failure hooks.
- Provide the experimental Vue MCP App boundary from the MCP-owned `/vue`
  entrypoint so the Vue runtime remains provider-neutral.

## v1.0.0-beta.1

- Support stable `latest` releases and independent `mcp-v*` releases without
  changing the trusted publishing workflow identity or rebuilding artifacts.
- Align `@lupinum/better-convex-nuxt`, `@lupinum/better-convex-vue`, and
  `@lupinum/better-convex-mcp` on the first 1.0 beta contract.
- Replace the old auth export paths and separate executables with the focused
  `better-auth/*` entries and one `better-convex` command.
- Move the Vue MCP App integration to `@lupinum/better-convex-mcp/vue` so the
  Vue runtime remains identity-safe and provider-neutral.
- Standardize public reactive progress on `pending` and adopt bounded Nuxt,
  Convex, Vue, and Node compatibility ranges backed by exact tested versions.
- Add deferred and lazy query lifecycles, dynamic keyed multi-query state, and
  resumable pagination with generation-safe reset and overlap handling.
- Add one reviewed `createBetterConvexAuth` factory and an idempotent,
  confirmation-gated development initializer that never prints generated secrets.
- Harden cookie forwarding, auth failure classification, serialized error revival,
  OAuth/MCP routing, and request-scoped sanitized MCP tool failure hooks.
- Focus DevTools on query gates, operation timelines, auth/proxy state, and
  sanitized agent boundary diagnostics without polling or editing controls.

## v0.8.0-beta.40

- Move all publishable packages to the `@lupinum` npm scope. This is a hard
  cutover: use `@lupinum/better-convex-nuxt`, `@lupinum/better-convex-vue`, and
  `@lupinum/better-convex-mcp`.
- Hard-cut Better Convex to one Vue-owned client lifecycle, one integrated
  Better Auth client, identity-partitioned SSR/query state, and direct callable
  mutation/action contracts without compatibility shims.
- Make authentication opt-in, keep no-auth installs free of Better Auth, and
  expose an opaque token-free attachment for embedded Vue consumers.
- Ship provider-neutral MCP request handling on the official server, exact
  OAuth resource verification, provider-owned live access checks, and the
  experimental Vue MCP App client boundary.
- Replace repeated release rehearsals with one source certification followed
  by immutable artifact checks, protected npm publication, and exact registry
  byte comparison.
- Refresh every maintained candidate lock against the final package bytes, make
  the local candidate registry compatible with the 24-hour dependency policy,
  and replace the demo's vulnerable `fontless` esbuild version.

## v0.8.0-beta.28

- Bind all three publishable package manifests to the canonical
  `https://github.com/lupinum-dev/better-convex` repository and make that
  provenance identity a release-certification invariant.
- Build the MCP workspace entry directly through the root `unbuild` authority
  during Nuxt prepack so pnpm cannot create a nested package lockfile.
- Preserve the exact Nuxt `4.5.1`, Vite `8.1.5`, Vue `3.5.40`, and experimental
  MCP `2026-07-28` boundaries.

## v0.1.0-beta.16 (`better-convex-mcp`)

- Declare and certify the canonical repository URL required for npm trusted
  publishing and signed provenance.

## v0.8.0-beta.26

- Build the MCP source-test entry through the root workspace's installed
  `unbuild` command and explicit package directory. The source checkout stays
  read-only while the same public MCP entry is compiled before tests.

## v0.6.1

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.6.0...v0.6.1)

### 🔒 Dependency and CI hardening

- Updated the exact supported Convex version to `1.42.1` across the package,
  fixtures, demo, and maintained starters.
- Updated the release toolchain, including ESLint 10, Playwright 1.61,
  `@nuxt/eslint-config` 1.16, `@vitejs/plugin-vue` 6.0.8, `convex-test` 0.0.54,
  lint-staged 17, oxfmt 0.59, and the latest compatible stable supporting
  packages.
- Updated pinned GitHub Actions for checkout, Node setup, pnpm setup, and
  TruffleHog; the TruffleHog binary input now matches the pinned action, and
  checkout credentials are not persisted into subsequent job steps.
- Kept TypeScript on the latest compatible 5.9 release because TypeScript 7 is
  outside the current Nuxt, ESLint, and Convex peer ranges.

### ✅ Reliability

- Adapted error construction and local assignments to the stricter ESLint 10
  rules without changing public behavior.
- Made the small Convex backend test corpus run serially, avoiding CPU-contention
  timeouts while preserving the existing per-test failure bound.
- Regenerated and frozen-validated the exact candidate resolution in the demo
  and all five maintained starters.

## v0.6.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.5.0...v0.6.0)

This is the vNext hard cutover. It replaces the pre-0.6 auth, query-argument,
error, and server-call surfaces outright — there is no compatibility shim and
no deprecation period. Upgrading requires reading the sections below; most
consumers will need source changes.

### 🔒 Security hardening

- Fixed authentication to one same-origin `/api/auth` proxy, GET/POST only,
  with one validated upstream request, no server-side redirect following, and
  no caller-controlled forwarding headers.
- Preserved request bytes and one deadline through complete response
  consumption, including bounded request/response bodies and deterministic
  stream cancellation.
- Made Better Auth's public reactive session the canonical client identity
  source across built-in, raw, and plugin operations, MFA settlement, expiry,
  cross-tab logout, and account switching.
- Serialized complete sign-in, sign-up, and sign-out operations so stale work
  cannot publish a superseded identity.
- Removed cross-origin CORS/trusted-origin configuration, custom proxy routes,
  the cross-request JWT cache, and its public clear helper.
- Hardened maintained demo and starter Convex functions with server-side
  authorization, tenant ownership checks, bounded reads/writes, pagination,
  body limits, and invariant tests.
- Narrowed supported Nuxt versions to `^4.4.0`; Better Auth, its Convex adapter,
  and Convex use exact tested peer versions.

### ✅ Release assurance

- Added deterministic isolated E2E execution, real Nitro proxy probes, seeded
  proxy property tests, browser identity lifecycle coverage, and a two-tab
  session/account-switch matrix.
- Added a machine-checked OWASP ASVS 5.0.0 Level 2 responsibility/evidence
  ledger covering all 253 applicable Level 1/2 controls.
- Added production dependency auditing, CycloneDX SBOM generation, secret
  scanning, CodeQL, pinned CI actions, Dependabot, and exact-tarball release
  gates across the demo and all five maintained starters.
- Release preparation now builds and packs once, verifies that exact immutable
  tarball, records its manifest and SHA-256, and leaves npm publication and Git
  tagging as explicit operator actions.

### 💥 Breaking changes

**Auth installation, config, and runtime topology**

- Removed `auth.enabled` as a separate boolean. Authentication now installs by
  default (or via an options object); pass `auth: false` as the sole
  off-switch. `defaults.auth` no longer exists.
- Removed `auth.cache.enabled` and `auth.unauthorized.enabled`/`auth.unauthorized`.
  The auth cache option is now a plain `false | options` value with no nested
  `enabled` flag, and unauthorized-route recovery no longer exists in module
  options, runtime config, or source.
- Removed `auth: 'auto'`. Query auth modes are exactly `required | optional | none`,
  with identical meaning on client and server. The default mode is `optional`.

**Query modes and cross-identity isolation**

- `optional`/`required` queries now wait for initial auth settlement before
  running, and are partitioned by the caller's stable identity key plus an
  `identityGeneration` counter — no query, paginated page, optimistic update,
  mutation/action result, upload, callback, or seeded-profile state can leak
  across a sign-in/sign-out/user-switch boundary.
- `none` queries always use a dedicated, permanently anonymous transport and
  never observe a Convex identity, even when the app is otherwise signed in.
- Same-user token rotation (refresh) no longer forces query reacquisition.
- Every identity-key change (anonymous↔user, user↔user) retires and closes the
  previous primary `ConvexClient` and replaces it; the public `useConvex()`
  handle and the dedicated anonymous client stay stable across the swap.

**Explicit query arguments; surface removal**

- Queries must always be called with an explicit args object or the literal
  string `'skip'`. Omitted-argument calls (e.g. `useConvexQuery(api.x.y)`) are
  no longer accepted.
- Removed `getQueryKey` and the `better-convex-nuxt/composables` subpath.
  Public types are imported from the package root.

**`ConvexCallError`**

- Introduced `ConvexCallError` as the one public error type for both throwing
  and safe (`{ data, error }`-style) call paths. It survives Nitro/SSR
  serialization with its identity and public fields (`kind`, `code`, `message`,
  `status`, `data`) intact; `cause` is never serialized or logged.
- Unstructured upstream response bodies can no longer reach public errors,
  logs, or payloads.

**Typed Better Auth client**

- Better Auth client plugins are now registered once per Nuxt app through
  `defineConvexAuthClient` in a project's `convex-auth.ts`, using the
  framework-free `better-convex-nuxt/auth-client` entry. Removed
  `createBetterConvexAuthClient`, `resolveBetterConvexAuthBaseURL`, and the
  `BetterConvexAuthClientOptions`/`BetterConvexAuthClientPluginList` types.

**Atomic sign-in/sign-up**

- `signIn`/`signUp` now synchronize the Convex identity automatically as part
  of the call; there is no manual post-sign-in/sign-up refresh step. `refresh()`
  remains available only for advanced raw-client or claim-change flows.
- `useConvexAuth()` is available both when auth is enabled and when it is
  disabled (module option `auth: false`), reporting status `'disabled'` in the
  latter case.

**Server caller and credential exchange**

- `serverConvex` is now the only public server call API. Removed
  `serverConvexQuery`, `serverConvexMutation`, `serverConvexAction`, and
  `useConvexCall`.
- Better Auth cookie credential exchange is bounded, never follows a redirect
  with the credential attached, and never logs secrets. Raw Better Auth session
  tokens are not accepted as public bearer credentials.
- Removed the built-in `permissions` module option (both the `true` and
  `false` states) and the `createPermissions` permissions runtime. Permission
  rules are application/Convex policy, not library machinery. Replace package
  permission helpers with an application-owned UI capability composable backed
  by Convex queries, and continue enforcing authorization inside Convex handlers.

### 🧹 Cleanup

- Deleted `research/` and `experiments/` (concluded Phase 0 exploration,
  distilled into `src/ARCHITECTURE.md` and ADRs where durable; retained only in
  Git history).
- Removed the Phase 0 `test/proofs/auth-races`, `test/proofs/isolation`,
  `test/proofs/onupdate-rebinding`, and `test/proofs/ssr-errors` prototype
  fixtures; their guarantees are now covered by permanent unit, Nuxt, and e2e
  tests (`test/unit/auth-generation-races.test.ts`, `test/unit/client-owner.test.ts`,
  `test/nuxt/auth-two-app-isolation.nuxt.test.ts`,
  `test/e2e/ssr-errors-consumer.e2e.test.ts`, and related identity/anonymous-
  transport Nuxt tests).

### 📖 Documentation

- Rewrote guides and examples onto the final vNext API (explicit query args,
  `optional`-by-default auth modes, `serverConvex`, `defineConvexAuthClient`,
  the replacement-safe `useConvex()` handle, structured error classification,
  and application-owned UI capabilities).

## v0.5.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.4.0...v0.5.0)

### 🩹 Fixes

- Remove unnecessary override for parent workspace in pnpm configuration ([7f6b2bb0](https://github.com/lupinum-dev/better-convex/commit/7f6b2bb0))

### 💅 Refactors

- Simplify landing feature syntax in documentation ([eef25d41](https://github.com/lupinum-dev/better-convex/commit/eef25d41))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.4.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.3.4...v0.4.0)

Reconstructed from the tagged commit range and the published `0.4.0` npm
release; this section was missing from the changelog until the vNext Phase 6
repair. No new facts beyond what the commit range and the release itself
show — see the [`v0.4.0` GitHub release](https://github.com/lupinum-dev/better-convex/releases/tag/v0.4.0)
and the [published package](https://www.npmjs.com/package/better-convex-nuxt/v/0.4.0)
for the authoritative record if this summary is ever in question.

### 🚀 Enhancements

- Export `ConvexUser` from the module entrypoint ([c78b6926](https://github.com/lupinum-dev/better-convex/commit/c78b6926))
- Harden starters and add the MCP approval flow, including Convex Nuxt runtime
  contract hardening, SSR-safe mutation callables, extracted server auth
  snapshot/shared-query/upload-queue/paginated-query internals, unified live
  query subscriptions, and a Better Auth Organization-backed team starter
  ([6fbf0bd5](https://github.com/lupinum-dev/better-convex/commit/6fbf0bd5))

### 🩹 Fixes

- Prepare starters and demo for the `0.4.0` release ([d18763fb](https://github.com/lupinum-dev/better-convex/commit/d18763fb))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.3.4

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.3.0...v0.3.4)

### 🏡 Chore

- **release:** V0.3.1 ([134fbdc](https://github.com/lupinum-dev/better-convex/commit/134fbdc))
- Update .npmignore and nuxt.config.ts ([5133e3e](https://github.com/lupinum-dev/better-convex/commit/5133e3e))
- Refine .npmignore to exclude additional unnecessary files ([1ad761a](https://github.com/lupinum-dev/better-convex/commit/1ad761a))
- Bump version to v0.3.3 to fix npm release pipeline ([638c188](https://github.com/lupinum-dev/better-convex/commit/638c188))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>

## v0.3.1

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.3.0...v0.3.1)

## v0.3.0

[compare changes](https://github.com/lupinum-dev/better-convex/compare/v0.2.12...v0.3.0)

### 🚀 Enhancements

- Enhance permissions handling and DevTools integration ([2c3ec80](https://github.com/lupinum-dev/better-convex/commit/2c3ec80))
- Add guard pages for pending authentication and enhance query handling ([8fd90d9](https://github.com/lupinum-dev/better-convex/commit/8fd90d9))
- Enhance defineSharedConvexQuery with fingerprinting and duplicate key handling ([5b8e339](https://github.com/lupinum-dev/better-convex/commit/5b8e339))
- Api polish, prepare for release ([a9fb1c3](https://github.com/lupinum-dev/better-convex/commit/a9fb1c3))
- Api polish ([83728a5](https://github.com/lupinum-dev/better-convex/commit/83728a5))
- Add consumer smoke test setup ([5cacd7c](https://github.com/lupinum-dev/better-convex/commit/5cacd7c))

### 🩹 Fixes

- Enhance testing commands and improve local environment setup ([b0c2a09](https://github.com/lupinum-dev/better-convex/commit/b0c2a09))
- Update TypeScript comment in nuxt.config.ts for clarity ([1eabe82](https://github.com/lupinum-dev/better-convex/commit/1eabe82))
- Update CI workflow for module packing and verification ([55323c0](https://github.com/lupinum-dev/better-convex/commit/55323c0))

### 💅 Refactors

- Auth ([157fd65](https://github.com/lupinum-dev/better-convex/commit/157fd65))
- Enhance authentication configuration and documentation ([d09c42a](https://github.com/lupinum-dev/better-convex/commit/d09c42a))
- Streamline Convex configuration and enhance authentication handling ([2d09cdb](https://github.com/lupinum-dev/better-convex/commit/2d09cdb))
- Unify Convex configuration access across composables ([b78a514](https://github.com/lupinum-dev/better-convex/commit/b78a514))
- ⚠️ Modernize Nuxt 4/Vue 3.5 runtime, harden auth proxy, and add cache-reuse recipe/demo ([7e7eb57](https://github.com/lupinum-dev/better-convex/commit/7e7eb57))
- Update error handling and improve component structure ([6cefde9](https://github.com/lupinum-dev/better-convex/commit/6cefde9))
- Migrate to useConvexAuth for authentication handling ([16f82c7](https://github.com/lupinum-dev/better-convex/commit/16f82c7))
- Finish release Candidate ([a50ea1d](https://github.com/lupinum-dev/better-convex/commit/a50ea1d))
- Split useConvexQuery => useConvexQueryLazy ([03852a9](https://github.com/lupinum-dev/better-convex/commit/03852a9))
- Streamline Convex URL handling and improve site URL derivation ([0ff5c2f](https://github.com/lupinum-dev/better-convex/commit/0ff5c2f))
- Update mutation handling and query arguments in playground components ([4f1c399](https://github.com/lupinum-dev/better-convex/commit/4f1c399))
- Improve runtime configuration handling for Convex ([4d10fdc](https://github.com/lupinum-dev/better-convex/commit/4d10fdc))

### 📖 Documentation

- Enhance documentation for HTTP-only mode in Convex queries ([b15f832](https://github.com/lupinum-dev/better-convex/commit/b15f832))
- Update data fetching and pagination examples for reactive arguments ([d0fadb9](https://github.com/lupinum-dev/better-convex/commit/d0fadb9))
- Enhance permissions setup and introduce upload queue functionality ([4228ae4](https://github.com/lupinum-dev/better-convex/commit/4228ae4))
- Update import paths and enhance documentation for file storage and query handling ([6e17d3e](https://github.com/lupinum-dev/better-convex/commit/6e17d3e))
- Enhance authentication and data fetching documentation ([1e35508](https://github.com/lupinum-dev/better-convex/commit/1e35508))
- Update API surface documentation and generation script ([252ac6d](https://github.com/lupinum-dev/better-convex/commit/252ac6d))
- Update query/mutation handling ([5b657bc](https://github.com/lupinum-dev/better-convex/commit/5b657bc))
- Update mutation handling to use `execute()` instead of `mutate()` ([ae179a9](https://github.com/lupinum-dev/better-convex/commit/ae179a9))

### 🏡 Chore

- **release:** V0.2.12 ([df71928](https://github.com/lupinum-dev/better-convex/commit/df71928))
- Bump deps ([d8bbdbd](https://github.com/lupinum-dev/better-convex/commit/d8bbdbd))
- Add Nuxt test-utils configuration and update dependencies ([e7c5f5c](https://github.com/lupinum-dev/better-convex/commit/e7c5f5c))
- Update testing configurations and enhance test scripts ([78c5f0f](https://github.com/lupinum-dev/better-convex/commit/78c5f0f))
- Polish and prepare beta ([5c03668](https://github.com/lupinum-dev/better-convex/commit/5c03668))
- Update pnpm-lock.yaml to include @vitejs/plugin-vue ([3a95bd9](https://github.com/lupinum-dev/better-convex/commit/3a95bd9))
- Add Playwright browser installation step in CI workflow ([d979e22](https://github.com/lupinum-dev/better-convex/commit/d979e22))
- Update playground for new API ([3746396](https://github.com/lupinum-dev/better-convex/commit/3746396))
- Enhance playground configuration and logging ([a288f22](https://github.com/lupinum-dev/better-convex/commit/a288f22))
- Update project configuration and improve mutation handling ([96645b1](https://github.com/lupinum-dev/better-convex/commit/96645b1))
- Clean up nuxt.config.ts by removing unnecessary whitespace ([62dc1d1](https://github.com/lupinum-dev/better-convex/commit/62dc1d1))
- Update deps & format ([16e0b8f](https://github.com/lupinum-dev/better-convex/commit/16e0b8f))
- Update dependencies and Renovate configuration ([1e7e9e0](https://github.com/lupinum-dev/better-convex/commit/1e7e9e0))
- Prepare package version for release ([7dd3ee7](https://github.com/lupinum-dev/better-convex/commit/7dd3ee7))

### ✅ Tests

- Improve selector logic in useConvexConnectionState behavior tests ([e7fddb2](https://github.com/lupinum-dev/better-convex/commit/e7fddb2))
- Enhance connection state behavior tests with improved waiting logic ([b3285a7](https://github.com/lupinum-dev/better-convex/commit/b3285a7))
- Harden dedup, permission guard, and optimistic update coverage ([6a33a8a](https://github.com/lupinum-dev/better-convex/commit/6a33a8a))
- Add end-to-end test for plugin server misconfiguration overlay ([b33601e](https://github.com/lupinum-dev/better-convex/commit/b33601e))

#### ⚠️ Breaking Changes

- ⚠️ Modernize Nuxt 4/Vue 3.5 runtime, harden auth proxy, and add cache-reuse recipe/demo ([7e7eb57](https://github.com/lupinum-dev/better-convex/commit/7e7eb57))

### ❤️ Contributors

- Mat4m0 <matthias.amon@me.com>
