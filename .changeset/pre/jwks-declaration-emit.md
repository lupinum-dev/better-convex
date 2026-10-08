---
'@lupinum/better-convex-nuxt': patch
---

Fix declaration emit for apps that export the functions of `jwksOperatorFunctions()`: `./better-auth/server` now exports `SigningKeyRotationMetadata`, the type they return.
