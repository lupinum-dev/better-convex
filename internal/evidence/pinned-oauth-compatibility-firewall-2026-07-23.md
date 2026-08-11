# Pinned OAuth compatibility firewall — 2026-07-23

## Outcome

The OAuth hardening remains a mandatory, fail-closed compatibility firewall for
`@better-auth/oauth-provider@1.7.0-rc.1`. It is no longer presented as a generic
provider abstraction and its provider-private type does not enter BCN's public
declaration graph.

The implementation was cut at an existing ownership seam:

- `plugin.ts` owns Better Auth plugin composition, request guards, and session
  issuance;
- `oauth-provider-compat.ts` owns the exact installed provider profile, plugin
  order, hardened callback identity, disabled routes, and safe administrative
  mutations;
- `oauth-security.ts` owns provider-independent redirect, scope, request, and
  access-token invariants behind a local structural profile.

No registry, adapter framework, compatibility shim, or public option was added.
The composition file fell from 1,061 to 825 lines; the extracted compatibility
owner is 263 lines.

## Dependency differential

The executed differential test constructs the exact installed provider and
proves that its upstream constructor accepts profiles missing each of:

- `clientPrivileges`;
- `resourcePrivileges`;
- `customAccessTokenClaims`.

BCN rejects each corresponding profile with `AUTH_OAUTH_CONFIG_INVALID` before
the provider can serve requests. The same suite proves that the installed
callbacks are the hardened wrapper identities, not the raw application
callbacks. This preserves the control that prevents an ordinary authenticated
session from inheriting OAuth-administrator authority through an omitted
upstream callback.

## Public boundary

An initial direct alias to the upstream `OAuthOptions` type was rejected by the
packed export checker because it would make `@better-auth/oauth-provider` part of
the public `better-convex-nuxt/convex-auth` type graph. The final implementation
uses a local, deliberately narrow `PinnedOAuthProviderProfile`. Runtime
differential tests—not a public provider type—bind it to the exact dependency.

## Executed proof

- `pnpm exec vitest run test/security/convex-auth-oauth-provider-compatibility.test.ts test/security/convex-auth-oauth-security.test.ts`
  — 3 files, 191 tests passed.
- `pnpm test:oauth` — 3 files, 161 tests passed.
- `pnpm run check:auth-advisories` — passed.
- `pnpm check:auth-provenance --source-only` — 29 records passed.
- `pnpm prepack` — package build, nine-entry deep export graph, and source/dist
  single-runtime-owner checks passed.
- `pnpm verify:auth` — schema/deployment, adapter, OAuth, fuzz, packed secret
  sentinels, concurrency, OAuth transport quota,
  authorization-code single consumption, export sentinels, MFA, direct PKCE,
  live revocation, and MCP RC conformance all passed.

The full run also found and corrected one stale documentation assertion: MCP
Apps are an optional Vue client entry outside the base MCP server package, not a
base server capability. The corrected assertion requires that separation and
the absence of added server authority.

## Commits

- `40fa56cc` — isolate the pinned provider compatibility owner.
- `87b41f85` — keep provider-private types out of the public declaration graph.
- `c7452745` — align the MCP documentation test with the proven Apps boundary.
