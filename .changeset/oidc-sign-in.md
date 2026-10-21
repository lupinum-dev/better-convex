---
'@lupinum/better-convex-nuxt': minor
---

Add the `oidc` option to `createBetterConvexAuth` to sign in through your company's OpenID Connect identity provider, such as Keycloak.

A user who signs in through the identity provider, or links it, then signs in only through it.
The identity provider can end app sessions through back-channel logout, and app sessions also end at the next Convex session token refresh when the provider refuses the refresh token.
Add `auth.getOidcAccessToken(ctx)` for Convex actions that call your own services with the user's access token.
Add `jose` as a dependency.
