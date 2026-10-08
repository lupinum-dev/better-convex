---
'@lupinum/better-convex-nuxt': patch
---

Fix `useConvexAuth()` reporting `status: 'error'` for a moment during a normal sign-out. A session the server ended is now reported as signed out once Better Auth confirms it; a session Better Auth still holds stays an authentication error.
