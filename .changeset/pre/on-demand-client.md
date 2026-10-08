---
'@lupinum/better-convex-nuxt': patch
---

Add `client.connect: 'on-demand'` and `useConvexActivation()` to start the browser runtime only when a page needs it.
Public pages then load no Convex or Better Auth client and open no WebSocket. `activate()` starts it; the auth route middleware starts it for pages with `convexAuth` metadata.
