# Better Convex Nuxt Starters

These starters are separate apps, not one configurable template. Use the
smallest starter that matches the product you are building.

The shared identity rule across the repo is narrower and deliberate: **Better
Auth owns human identity and sessions; Convex product data refers to people by
Better Auth logical string IDs.** Tenant authorization has one explicit owner
per starter. `team` uses the Better Auth Organization plugin; `agency` models
its product-specific client/workspace delegation directly in Convex. None keeps
a second copy of Better Auth user or session state. Experimental agent work
remains under `internal/labs` until a real provider-backed path is proven.

| Starter  | Authorization model              | Status                                  |
| -------- | -------------------------------- | --------------------------------------- |
| `public` | none (no auth)                   | Stable baseline                         |
| `team`   | Better Auth Organization         | Canonical human B2B reference           |
| `agency` | app-owned client/workspace graph | Intentional product-authorization model |

## `public`

A public Nuxt + Convex todo app with no auth runtime.

- **Owns:** its own product tables (todos) and the todo invariants.
- **Does not own:** any auth, organization, member, or role state — the module's
  auth features are disabled.

## `team`

The canonical B2B SaaS baseline built on the Better Auth Organization plugin
with static roles (`owner`/`admin`/`member`/`viewer`) and teams.

- **Owns:** product tables (`projects`, `auditEvents`, a rebuildable `users`
  projection) keyed by Better Auth string IDs. Backend authorization delegates
  to `auth.api.hasPermission` and reads roles from the Better Auth `member` row
  (`convex/lib/authz.ts`).
- **Does not own:** organizations, members, roles, invitations, or teams — all
  live in the Better Auth component. There is no app-owned `organizations` table
  and no `role` column on `users`. Enforced by
  `test/unit/starter-organization-ownership.test.ts`.

## `agency`

An agency/client workspace starter with explicit organization links and
delegated project access.

- **Owns:** app-owned `organizations` and `memberships` tables, organization
  links, delegated project access, and access-path audit.
- **Does not own:** Better Auth identity/session. It does **not** enable the
  Better Auth Organization plugin because its client/workspace links are the
  canonical product-authorization graph, not a mirror of Better Auth tenant
  rows. Logical Better Auth user IDs identify the humans in that graph.

## Starter-family design principles

- **Never duplicate a product function per caller.** Nuxt UI, Nitro routes,
  MCP tools, and Convex Agent tools must all call the same Convex
  query/mutation/action and the same actor/access/audit logic — never
  `projects.update` plus a parallel `projects.updateForMcp`.
- **Tool listings are advisory only.** MCP/agent tool metadata is a hint for
  the caller; the Convex handler always re-checks current authority
  regardless of what a tool listing implied.
- **Approval binds to specifics, not just an actor.** A destructive-write
  approval record binds actor, organization/workspace, action/tool id, a
  normalized args hash, expiry, and single-use consumed state — not just "this
  user approved something."
- **Compose Convex Agent before inventing agent state.** Do not build a
  generic agent-persistence/tool-approval component until a concrete starter
  proves Convex Agent cannot express its actor/workspace/approval model.
- **Duplication beats premature extraction.** See the shared-package rule
  above — it was the one research conclusion important enough to promote into
  this file directly.

The starters intentionally duplicate some backend access code. Do not extract a
shared B2B package until two starters have the same tested invariant and the
extracted API is smaller than the duplicated code.

Each starter ships tiny bootstrap files under `convex/_generated` (generic `any`
exports) so `pnpm test`, `pnpm typecheck`, and Nuxt builds work before you
configure a Convex deployment. They are not the schema source of truth — the
file-bound `pnpm convex:dev`/`pnpm convex:codegen` commands replace them. Do
not hand-edit them for application behavior; domain state and invariants belong
in `convex/schema.ts` and product modules.
