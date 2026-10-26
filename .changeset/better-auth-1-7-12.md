---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Change the Better Auth peers to 1.7.12 (stricter JWT key checks, RFC 6265bis cookies, OAuth client errors, safer password reset)

Migration: install `better-auth`, `@better-auth/core` and `@better-auth/oauth-provider` at exactly `1.7.12`.

Local auth components: regenerate the schema. `id` is now sortable, and with `oauthProvider()` the `oauthConsent` table gains a `clientId_userId_id` index. Better Auth 1.7.12 looks up OAuth consent by `id`; an old schema makes that lookup fail.

A profile that wires `oauthProvider` itself: add `/oauth2/client/rotate-keys` (new in 1.7.12) to `disabledPaths`. Without it, the factory refuses to start with `AUTH_OAUTH_CONFIG_INVALID`.

The token endpoint now answers a wrong client secret with `401 invalid_client` before it reads the authorization code, so the code is not spent; it still mints nothing and stays single-use. A wrong PKCE verifier is now `invalid_grant` (RFC 7636), not `invalid_request`.

MCP access tokens are now checked with `jose` and the keys from the auth component. Better Auth 1.7.12's own verifier uses a timer, and Convex queries and mutations do not allow timers.
