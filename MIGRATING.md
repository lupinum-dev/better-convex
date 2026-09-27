# Migrating to 1.0

The full guide, with old and new code for every change, is
[Upgrade to 1.0](https://better-convex.lupinum.com/docs/operations/upgrade-to-1-0)
(source: `docs/content/docs/6.operations/7.upgrade-to-1-0.md`). This file is the
checklist. It covers the move from `@lupinum/better-convex-nuxt` and
`@lupinum/better-convex-vue` `1.0.0-beta.7`, and `@lupinum/better-convex-mcp`
`1.0.0-beta.2`, to `1.0.0-rc.0`. 1.0 has no compatibility layer: the old names
are gone, and TypeScript reports most places that you must change.

## Packages and data

- [ ] Install the exact `1.0.0-rc.0` of `@lupinum/better-convex-nuxt` (or
      `@lupinum/better-convex-vue`) and, with MCP, `@lupinum/better-convex-mcp`.
- [ ] With auth, install `better-auth`, `@better-auth/core`, and
      `@better-auth/oauth-provider` at exactly `1.7.6`, even without MCP.
- [ ] With MCP, install `@modelcontextprotocol/server@2.1.0`; MCP Apps use
      `@modelcontextprotocol/ext-apps` `2.x`.
- [ ] The auth component `account` table drops `issuer` and is keyed by
      `(providerId, accountId)`. This needs data work: Convex rejects the deploy
      while account rows still contain `issuer`, and 1.0 ships no migration. A
      deployment with beta account rows needs a new, empty `betterAuth`
      component (users sign up again).
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
      `oauthLiveAccess`, and `pruneSigningKeys`, and no longer exports
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
- [ ] Session tokens carry `name`, `email`, `emailVerified`, and `image` by
      default; remove them from `defineSessionClaims`.

## Composables and errors

- [ ] `useConvexMutation` returns `{ mutate, data, status, pending, error, reset }`;
      destructure `mutate`.
- [ ] `useConvexAction` returns `{ run, data, status, pending, error, reset }`;
      destructure `run`.
- [ ] A second `useConvexForm` `submit()` while one is pending rejects with
      `SUBMIT_IN_PROGRESS`.
- [ ] Pagination: `pageStatus` and `cursor` are gone; `status` and `pending`
      describe the first page only; use `canLoadMore`, `isLoadingMore`, and
      `isExhausted`; `loadMore()` returns a promise that never rejects.
- [ ] `ConvexCallError.message` of a `server` error is the text your Convex
      function wrote; check that it is safe to show.
- [ ] Read error codes with `isConvexCallError(error, code)` from
      `@lupinum/better-convex-nuxt/errors` instead of reading `data`.
- [ ] `upload()` failures have codes, and `cancel()` makes the pending upload
      reject with `CANCELLED`.
- [ ] `useConvexAuth().client` is never `null`; during SSR its methods throw
      `CLIENT_UNAVAILABLE`.
- [ ] A query with `server: false` is `idle` during SSR and hydration; treat
      `idle` like `pending`.

## MCP

- [ ] `configureServer` receives one `{ access, principal, server, tools }`
      object instead of positional arguments.
- [ ] `createBetterAuthMcpAccessVerifier` takes `(ctx, component, options)`
      and has no `jwksUrl` or `validateLiveAccess`; use
      `auth.createMcpAccessVerifier(ctx)`.
- [ ] Internal MCP functions take `principal: mcpPrincipalValidator` and call
      `auth.requireMcpPrincipal(ctx, principal, { scope })`.
- [ ] Requests without the `MCP-Protocol-Version` header get HTTP `400`.
