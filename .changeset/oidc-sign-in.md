---
'@lupinum/better-convex-nuxt': minor
---

Add the `oidc` option to `createBetterConvexAuth` to sign in through your company's OpenID Connect identity provider, such as Keycloak.

A user who signs in through the identity provider, or links it, then signs in only through it.
App sessions end through back-channel logout, and at the next Convex or MCP token when the provider refuses the refresh token.
`oidc.onSignIn` receives the verified ID-token claims at each sign-in, for roles and access checks; `oidc.scopes` adds scopes such as `offline_access`.
Add `auth.getOidcAccessToken(ctx)` for Convex actions that call your own services with the user's access token.
Add `jose` as a dependency.
