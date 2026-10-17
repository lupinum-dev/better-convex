---
'@lupinum/better-convex-functions': minor
---

Add a public `action` builder, so work a person starts in the browser needs no raw Convex action

Create it once: `export const { authorizeAction } = fns` and `export const action = fns.action(internal.functions.authorizeAction)`.
Before the handler runs, `authorizeAction` checks the caller, the policy and the tenant the arguments name, like a public mutation, and takes the action's rate-limit token.
A call that names no tenant gets `FORBIDDEN`; an action without tenant sets `tenantless: true`, and then every signed-in person may run it.
The handler gets `ctx.actor`; `ctx.runQuery`, `runMutation`, `runAction` and `scheduler` reach internal operations as that actor.
An action is not a tool, and agents cannot call it.
