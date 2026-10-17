---
'@lupinum/better-convex-functions': minor
---

Change a call that names no tenant to need a role. `roleOf(ctx, user, null)` gives the role outside any tenant.

Before, such a call skipped the role check, and only row rules held it: a function that touches no row, or only rows whose rule checks no role, ran for any signed-in person.
`null` refuses the call unless its action is public. What every signed-in person may do is a role, for example `signedIn`. An app with one workspace returns the member's role and needs no role checks in handlers.
A public function that no role allows, and that is not public, fails when it is built. A deleted ID and a foreign ID get the same `NOT_FOUND` message.
Migration: `roleOf` receives `null` for a call that names no tenant. Return a role (for example `'signedIn'`, listing what every signed-in person may do) or `null`, and delete role checks in handlers or builder wrappers.
