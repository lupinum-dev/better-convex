# Migrating to 1.0

The full guide, with old and new code for every change, is
[Upgrade to 1.0](https://better-convex.lupinum.com/docs/operations/upgrade-to-1-0)
(source: `docs/content/docs/6.operations/7.upgrade-to-1-0.md`). This file is the
checklist. It covers the move from `@lupinum/better-convex-nuxt` and
`@lupinum/better-convex-vue` `1.0.0-beta.7`, and `@lupinum/better-convex-mcp`
`1.0.0-beta.2`, to the 1.0 release candidate. 1.0 has no compatibility layer: the old names
are gone, and TypeScript reports most places that you must change.

## From 1.0.0-rc.1

If you already run the release candidate, check only these:

- [ ] Replace `status === 'loading'` with `status === 'pending'` on
      `useConvexAuth()`. Keep your own `ref` around a sign-in or sign-out call
      to disable a button; `pending` no longer covers it.
- [ ] Replace `upload(file, args, { context })` with `upload(file, { args, context })`.
- [ ] Delete query and paginated query `refresh()` calls.
- [ ] Rename `reset(` to `restart(` on `useConvexPaginatedQuery` results.
- [ ] Import `useConvexOperation` from `@lupinum/better-convex-nuxt/experimental`
      (or `@lupinum/better-convex-vue/experimental`).
- [ ] Set `convex.auth.origin` and the Convex `SITE_URL` to the same origin, or
      list the origin in `siteOrigins` (not possible with `oauth` or
      `oauthProvider`). Remove `BETTER_AUTH_TRUSTED_ORIGINS`.
- [ ] Component tests: a mutation that passes `optimisticUpdate` now fails.
- [ ] Local auth component: regenerate the schema and export `pruneRateLimits`.
- [ ] MCP: `@lupinum/better-convex-mcp` is now `@lupinum/better-convex-agents`.
      Install `@lupinum/better-convex-agents@next` and
      `@lupinum/better-convex-functions@next` (a peer), remove
      `@lupinum/better-convex-mcp`, and import `handleMcpRequest`,
      `projectMcpToolError` and the verifier types from
      `@lupinum/better-convex-agents/mcp`, `listMcpCatalog` from
      `@lupinum/better-convex-agents/test`. Install
      `@modelcontextprotocol/server@2.2.0` (rc.1 used `2.1.0`), and for MCP
      Apps `@modelcontextprotocol/client@2.2.0` and
      `@modelcontextprotocol/core@2.2.0`.
- [ ] MCP: `defineMcpTool` and `registerMcpTool` are removed. With
      `@lupinum/better-convex-functions`, give the operation a `tool` field and
      collect the tools with `defineTools`; serve them with `createMcpServer`
      from `@lupinum/better-convex-agents/mcp`. Without it, register the tool
      with `server.registerTool(name, config, callback)`: `risk` becomes
      `annotations`, `scopes` becomes `scopeChallenge: tools.requireScopes(...)`.
- [ ] MCP: `runMcpTool(operation, { name })` is removed. Use
      `tools.runTool(name, operation)` inside `configureServer`.
- [ ] MCP without `defineFunctions` (your own `handleMcpRequest` and
      `server.registerTool` calls, as in ginko-cms): install
      `@lupinum/better-convex-functions@next` anyway, at the same version as
      the agents package; it is a required peer. Then replace each
      `runMcpTool(operation, { name })` with `tools.runTool(name, operation)`,
      where `tools` comes from the `configureServer` argument.
- [ ] MCP: `auth.mcp` is removed. Spread `auth.mcpAuthorization(ctx)` into the
      `handleMcpRequest` options instead of passing `auth.mcp.resource()`,
      `auth.mcp.issuer()` and `auth.mcp.scopesSupported()`. Leave `resource`
      out of `auth.oauthOperator.createPublicClient`: the client is then bound
      to the MCP resource.

## Packages and data

- [ ] Install `@lupinum/better-convex-nuxt@next` (or
      `@lupinum/better-convex-vue@next`) and, with MCP, `@lupinum/better-convex-agents@next`
      and `@lupinum/better-convex-functions@next` (they replace `@lupinum/better-convex-mcp`).
      The `next` dist-tag is the 1.0 release candidate.
- [ ] With auth, install `better-auth`, `@better-auth/core`, and
      `@better-auth/oauth-provider` at exactly `1.7.6`, even without MCP.
- [ ] With MCP, install `@modelcontextprotocol/server@2.2.0`; MCP Apps use
      `@modelcontextprotocol/ext-apps` `2.x`.
- [ ] The auth component `account` table is keyed by `(providerId, accountId)`.
      Beta account rows keep their retired `issuer` column (optional, never
      read or written), so the deploy accepts them, and users, account IDs,
      passwords, and linked providers stay. After you deploy, run
      `findAccountKeyCollisions` from an internal action. A reported group
      (possible only when a provider's issuer changed during the beta) cannot
      sign in until you merge or delete its extra rows.
- [ ] Deploy normally: the auth component schema accepts every beta row, so
      you do not export, import, or clear any table.
- [ ] With MCP or the OAuth provider, expect beta refresh tokens to stop
      working. They have no consent binding, so 1.0 answers them with
      `invalid_grant`; MCP hosts and other OAuth clients sign in again. The
      old rows can stay.
- [ ] Regenerate a local auth component schema with
      `better-convex auth schema`.

## Removed APIs

- [ ] `workforce: true`, `createWorkforceAuthSchemaOptions`, and
      `workforceSessions.*`: use the Better Auth `twoFactor` option and session
      endpoints.
- [ ] `@lupinum/better-convex-mcp/vue` and `useMcpApp`: use the `App` class
      from `@modelcontextprotocol/ext-apps`.
- [ ] `oauthPopupClient()` in `defineConvexAuthClient`: use
      `client.signIn.social()`.
- [ ] `verifyOAuthBearerToken`: use `auth.createMcpAccessVerifier(ctx)`.
- [ ] The beta.3 user migration (`migrateBeta3UserGeneration`): finish it on a
      beta release before you upgrade.
- [ ] `convexAuth`, `createAuthComponent`, `createConvexAuthRateLimitStorage`,
      and `requireWritableAuthCtx` are no longer exported: use
      `createBetterConvexAuth`.
- [ ] `auth.authComponent`: use `auth.getUser(ctx)`, `auth.requireUser(ctx)`,
      and `auth.getAuth(ctx)`.
- [ ] Types `UseConvexCall` and `UploadStatus`: use `UseConvexMutationReturn`,
      `UseConvexActionReturn`, and `ConvexCallStatus`.
- [ ] Nuxt types `UseConvexQueryOptions` and `UseConvexPaginatedQueryOptions`:
      use `UseNuxtConvexQueryOptions` and `UseNuxtConvexPaginatedQueryOptions`.

## Auth

- [ ] The local `convex/betterAuth/adapter.ts` exports `expireSession`,
      `oauthLiveAccess`, `pruneRateLimits`, and `pruneSigningKeys`, and no longer exports
      `assertProfile` or the workforce functions.
- [ ] Export `pruneSigningKeys` from `auth.jwksOperatorFunctions()` and
      schedule it.
- [ ] `auth.requireUser` throws a `ConvexError` with code `UNAUTHENTICATED`,
      not the string `'Unauthenticated'`.
- [ ] One `email(ctx, message)` hook replaces `sendResetPassword`,
      `sendVerificationEmail`, `sendVerificationOTP`,
      `twoFactor.otpOptions.sendOTP`, and `organization.sendInvitationEmail`;
      those now fail with `AUTH_CONFIG_INVALID`.
- [ ] `emailAndPassword`, `emailVerification`, and `emailOTP` take plain
      objects, not a function of `ctx`.
- [ ] Password reset is off until you set `emailAndPassword.passwordReset: true`.
- [ ] `session.expiresIn` (1 hour to 30 days), `session.updateAge` (5 minutes
      to `expiresIn`), and `session.cookieCache.maxAge` (1 to 300 seconds) are
      bounded; `refreshCache` is rejected.
- [ ] `account.accountLinking.trustedProviders` accepts only configured social
      providers; any other key under `account` fails.
- [ ] Session tokens carry only library claims. If the client shows
      `name`, `email`, `emailVerified`, or `image` from `useConvexAuth().user`,
      return them from `defineSessionClaims`, for example
      `defineSessionClaims: ({ user }) => ({ name: user.name, email: user.email })`.
      In Convex functions, use `auth.getUser(ctx)`.

- [ ] `useConvexAuth().status` uses `'pending'` instead of `'loading'`, and
      `pending` follows `status`. Replace `status === 'loading'` and keep your
      own `ref` to disable a button while a sign-in or sign-out runs.

## Composables and errors

- [ ] Import `useConvexOperation` from
      `@lupinum/better-convex-nuxt/experimental` (Nuxt) or
      `@lupinum/better-convex-vue/experimental` (Vue). Nuxt no longer
      auto-imports it.
- [ ] Replace `upload(file, args, { context })` with
      `upload(file, { args, context })`. Omit `args` when the prepare mutation
      takes none.
- [ ] `useConvexMutation` returns `{ mutate, data, status, pending, error, reset }`;
      destructure `mutate`.
- [ ] `useConvexAction` returns `{ run, data, status, pending, error, reset }`;
      destructure `run`.
- [ ] Delete query and paginated query `refresh()` calls. Convex reruns a
      query when its data changes; a query error stays until its cause changes.
- [ ] Rename `reset(` to `restart(` on `useConvexPaginatedQuery` results.
- [ ] A second `useConvexForm` `submit()` while one is pending rejects with
      `SUBMIT_IN_PROGRESS`. A submission retired during validation sends
      nothing and resolves `{ ok: false }` with `IDENTITY_CHANGED` or
      `CANCELLED`.
- [ ] Pagination: `pageStatus` and `cursor` are gone; `status` and `pending`
      describe the first page only; use `canLoadMore`, `isLoadingMore`, and
      `isExhausted`; `loadMore()` returns a promise that never rejects.
- [ ] `ConvexCallError.message` of a `server` error is the text your Convex
      function wrote; check that it is safe to show.
- [ ] Read error codes with `isConvexCallError(error, code)` from
      `@lupinum/better-convex-nuxt/errors` instead of reading `data`.
- [ ] `upload()` resolves with `{ storageId, prepared, completed }`, not the
      storage ID, and `data` holds the same object. Move a follow-up save
      mutation into the `complete` option. Pass the record to attach to as
      `upload(file, { args, context })`. In `complete`, read it from
      `ctx.context`, not from component state. A prepare mutation that returns an
      object needs the `url` option.
- [ ] `upload()` failures have codes, `phase`, and `outcome`, and `cancel()`
      makes the pending upload reject with `CANCELLED`.
- [ ] Browser errors carry `outcome` (`'not-sent'` or `'unknown'`). An
      `IDENTITY_CHANGED` with `'not-sent'` was never sent.
- [ ] `useConvexAuth().client` is never `null`; during SSR its methods throw
      `CLIENT_UNAVAILABLE`.
- [ ] A query with `server: false` is `idle` during SSR and hydration; treat
      `idle` like `pending`.

## Component tests

- [ ] `@lupinum/better-convex-nuxt/test` runs the real composables. The
      `composables` map is gone: pass `convex.plugin` to `mountSuspended` and
      bind only `useConvexAuth` with `mockNuxtImport`.
- [ ] Requests stay pending until the test answers them. Mutation and action
      calls are request objects with `args`, `identity`, `state`, `resolve()`,
      and `reject()`; query calls have `identity`, and `'refresh'` is now
      `'query'`.
- [ ] The upload control uses `progress(loaded, total?)`, `fail(status)`, and
      `nextCall()`; `reject(error)` fails the upload-URL mutation.
- [ ] Plain Vue tests import `setupBetterConvexTest` from
      `@lupinum/better-convex-vue/test`.

## MCP

- [ ] `configureServer` receives one `{ access, principal, server, tools }`
      object instead of positional arguments.
- [ ] `createBetterAuthMcpAccessVerifier`, `auth.validateOAuthAccess`, and the
      `OAuthLiveAccess` type are removed. Use `auth.createMcpAccessVerifier(ctx)`
      in the HTTP action and `auth.requireMcpPrincipal(ctx, principal, { scope })`
      in the internal function.
- [ ] Every OAuth access token carries its consent ID, also with
      `renewal: false`; beta tokens without it are rejected and hosts sign in
      again. Disabling an OAuth resource rejects tokens already issued.
- [ ] Install the MCP SDK yourself; it is an exact peer:
      `pnpm add @lupinum/better-convex-agents@next @lupinum/better-convex-functions@next @modelcontextprotocol/server@2.2.0`.
- [ ] Internal MCP functions take `principal: mcpPrincipalValidator` and call
      `auth.requireMcpPrincipal(ctx, principal, { scope })`.
- [ ] Requests without the `MCP-Protocol-Version` header get HTTP `400`.
