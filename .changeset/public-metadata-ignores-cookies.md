---
'@lupinum/better-convex-nuxt': patch
---

Fix `/api/auth/jwks` and the OAuth authorization-server metadata answering 403 in a browser. The proxy rejected every request that carried a cookie, but browsers attach cookies to every same-origin visit: the signed-in session, or a platform cookie such as Vercel's. These public routes now ignore cookies and never forward them. They still reject `Authorization`, `DPoP` and `Proxy-Authorization`.
