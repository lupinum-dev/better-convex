---
'@lupinum/better-convex-nuxt': patch
'@lupinum/better-convex-vue': patch
---

Fix `/oauth2/public-client-prelogin` showing the name and contacts of any client to a visitor who holds the signed query of another client.

Also refuse a `loginPage` or `consentPage` that contains a backslash, and run the authorize, token and revoke checks for a path with a trailing slash too.
