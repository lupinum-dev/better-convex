---
'@lupinum/better-convex-nuxt': patch
---

Fix email codes being mailed when nothing can use them

A `forget-password` code is mailed only when `emailAndPassword.passwordReset` is `true`, and an `email-verification` code only to an address that is not verified yet. Before, anyone could make the app mail such codes to any existing user. The request still answers with success, so it does not show whether an account exists.
