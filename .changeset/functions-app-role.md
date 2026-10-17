---
'@lupinum/better-convex-functions': minor
---

Change how a call that names no tenant is decided: add `appRoleOf` for app-wide roles and `policy.signedIn`

`appRoleOf(ctx, user)` gives a person's role in the whole app, for an app with one workspace and no tenant tables. With it, every call that names no tenant needs that role, so handlers and wrappers no longer check roles. Without it, a query or mutation that names no tenant is still checked row by row.
A public action that names no tenant now needs `appRoleOf` or an action in `public` or `signedIn`: an action has no rows for row rules to check.
`policy.signedIn` lists actions every signed-in person may call, whatever their role. A public function that no role allows, and that is not in `public` or `signedIn`, fails when it is built.
A deleted ID and an ID from a place without a role now get the same `NOT_FOUND` message.
Migration: return your app-wide role from `appRoleOf` and delete role checks in handlers or builder wrappers; list actions every signed-in person may call in `policy.signedIn`.
