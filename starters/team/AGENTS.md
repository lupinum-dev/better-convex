# Team Starter Guardrails

- Better Auth owns membership, organization, team, invitation, session, and role state.
- Convex owns product state and product authorization invariants.
- Nuxt may display roles, but display state is never authorization.
- Keep product authorization policy in `convex/lib/authz.ts`.
- Keep product behavior in product modules such as `convex/projects.ts`.
- Do not add agency delegation here; use the `agency` starter.
- Do not add MCP or agent surfaces here; use the provider-neutral `better-convex-mcp`
  package and keep application authorization in the application.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`pnpm exec convex ai-files install`.

<!-- convex-ai-end -->
