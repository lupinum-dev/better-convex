---
'@lupinum/better-convex-nuxt': minor
---

Add `serverConvex(event).fetch(path)`, which reads one of your Convex HTTP actions as the caller and returns the upstream `Response` with its body as a stream, for private file downloads from your own origin.

It accepts only a path on the deployment's HTTP actions host and only `GET` or `HEAD`, follows the `auth` option like `query`, aborts with the request, and does not follow redirects. The body is not capped by `server.maxResponseBytes`.
