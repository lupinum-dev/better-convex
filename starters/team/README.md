# Team Starter

Canonical Nuxt + Convex + Better Auth starter for team SaaS products.

This starter is intentionally focused. It teaches one production-shaped path:

- Better Auth owns auth-domain state: users, sessions, organizations, members,
  invitations, teams, team members, and roles.
- The UI calls Convex for app behavior.
- Convex calls Better Auth APIs for auth-domain workflows.
- Nuxt `/api/auth/*` only exists for Better Auth transport and session exchange.
- Convex app tables own product-domain state: projects and audit events.
- `users` is a tiny display projection from Better Auth users.
- Every project belongs to one Better Auth organization and one Better Auth team.
- Project access is organization permission plus team access.
- Project deletion is soft delete with restore.
- Soft-deleted projects are purged after 30 days by a Convex cron job.

## Includes

- Email/password auth.
- Better Auth Organization with static roles.
- Organization invitations with Better Auth-managed acceptance and verified-email gating.
- Better Auth teams and default team flow.
- Team-scoped projects.
- Product authorization in Convex.
- Product audit in the same Convex mutation.
- Targeted Convex-backed rate limits for organization creation, invitations, and project creation.
- App-owned project-create rate-limit composable for temporary UI disable and retry messaging.
- Paginated project and audit queries.

`auditEvents` is intentionally product-only. Better Auth remains the canonical
source for organization, member, invitation, team, and team-member state; the
starter does not mirror those management actions into app tables.

## Security Decisions

- Backend checks are authoritative. UI capability flags only hide controls.
- Temporary create-project throttling is enforced in Convex and exposed through a checked query; the UI composable is display-only.
- Better Auth APIs are the canonical path for auth-domain workflows.
- Raw Better Auth component reads are reserved for narrow app-side checks such
  as team membership gates and org/team relationship validation.
- Project access requires both a Better Auth organization project permission and
  access to the Better Auth team that owns the project.
- Organization owners and admins may access every team in their organization.
  Members and viewers must be explicit Better Auth team members.
- `users` is a display projection only. It is rebuildable from Better Auth user
  state and must not be used as an authorization source.
- `auth:rebuildUserProjectionBatch` reconciles that projection in pages of 100:
  it inserts missing rows, refreshes stale display fields, and removes duplicate
  copies. Call the internal mutation from operator-only maintenance code with a
  `null` cursor, then repeat with `continueCursor` until `isDone` is true. The
  Better Auth delete trigger removes every copied row, including its PII fields.
- `auditEvents` records product events only. Organization, member, invitation,
  team, and team-member management remain in Better Auth's domain.
- The starter does not mix app-owned HTTP management wrappers with Convex hooks.
- The starter does not duplicate Better Auth org/member/team state in app tables.
- Invitation acceptance requires a logged-in session whose email matches the
  invited address.
- Invitation acceptance also requires that the invited email address is verified.
- Verification emails are sent automatically on sign-up and again on sign-in for
  unverified users.
- The app does not expose Better Auth invitation ids in organization management
  queries. Only the emailed invitation link carries the action-capable id.
- Verification and invitation delivery must be configured outside local
  development. The local fallback only logs links for localhost/test workflows.

## Not Included

- Admin user management.
- API keys.
- Dynamic roles.
- Passkeys.
- TOTP.
- Email OTP.
- Magic links.
- Stripe.
- SCIM.
- Public OAuth/OIDC/MCP.
- Agents.
- Organization deletion.
- Team deletion.
- Hard project deletion.

Rate limits are intentionally separate from permissions:

- Better Auth permissions decide whether a user may create a project at all.
- Convex rate limits decide how quickly repeated writes may happen.
- the create form disables itself temporarily only after reading checked Convex
  rate-limit state.

## Commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm test
pnpm typecheck
pnpm convex:codegen
pnpm convex:local:once
pnpm verify
pnpm verify:release
pnpm verify:browser
pnpm verify:full
```

`pnpm test` runs focused Convex tests for schema invariants, Better Auth user
projection, auth-domain Convex contracts, project lifecycle audit writes, role
permissions, invitation lifecycle, team membership, rate-limit enforcement, and
soft-delete query behavior.

`pnpm typecheck` runs Nuxt type checking. Without local Convex environment
values, the module can warn that no Convex site URL was resolved; that warning is
expected until the app is configured.

`pnpm verify` is the normal local gate: formatting, unit/contract tests, Convex
codegen, Nuxt type checking, and production build.

`pnpm verify:release` adds `pnpm convex:local:once`. Use it before publishing a
starter change, because it validates Convex functions and component code against
the local Convex runtime.

For first-time browser development, run `pnpm convex:configure`; use
`pnpm convex:dev` on later runs. Run it and `pnpm dev` in separate
terminals. Nuxt auth routes proxy to the local Convex HTTP site, so Nuxt alone
cannot complete Better Auth token exchange. Signed-out `401` responses from auth
token and organization-list endpoints are expected.

`pnpm verify:browser` starts local Convex and Nuxt, then drives a real browser
through sign-up, organization creation, team creation, project creation, rename,
soft delete, deleted-project view, restore, and active-project view. It requires
ports `3000`, `3210`, and `3211` to be free. If Chromium is not installed yet,
run `pnpm exec playwright install chromium`.

`pnpm verify:full` runs `pnpm verify:release` and then the browser happy path.

## Testing Strategy

This starter keeps tests close to the invariants that matter:

- Convex tests prove product schema shape, user projection behavior, Better Auth
  organization and team workflows through Convex, project audit writes, role
  permissions, team membership checks, and soft-delete visibility.
- Browser end-to-end tests are intentionally left to the consuming app. Add them
  once the app has a real product flow, seeded users, and environment-specific
  auth setup.
- This starter includes one local browser happy-path smoke as a wiring check.
  Keep broader role and cross-user E2E in the consuming app, where seeded test
  users and deployment-specific auth settings are known.

Recommended first browser flows for a production app:

- Owner signs up, creates an organization, creates a team, creates a project,
  renames it, soft-deletes it, and restores it.
- Owner invites a user, the user signs in through the invitation link, and the
  invited user lands in the correct organization/team.
- Viewer can read allowed data but cannot create, update, delete, or restore a
  project.
- Member can work inside an assigned team but cannot access another team in the
  same organization.

## Auth Environment

Set the auth origin and both independent secrets before using auth routes:

```bash
export BCN_AUTH_PROXY_IP_SECRET="$(openssl rand -base64 32)"
(
  set -eu
  umask 077
  sed '/^BCN_AUTH_PROXY_IP_SECRET=/d' .env.local > .env.local.next
  printf 'BCN_AUTH_PROXY_IP_SECRET=%s\n' "$BCN_AUTH_PROXY_IP_SECRET" >> .env.local.next
  mv .env.local.next .env.local
)
pnpm exec better-convex-nuxt-convex env set SITE_URL http://localhost:3000
printf '0:%s' "$(openssl rand -base64 32)" | pnpm exec better-convex-nuxt-convex env set BETTER_AUTH_SECRETS
printf '%s' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex-nuxt-convex env set BCN_AUTH_PROXY_IP_SECRET
```

In production, inject the same `BCN_AUTH_PROXY_IP_SECRET` into Nuxt with your
secret manager. Do not print or commit it.

Email delivery with Resend:

```bash
printf '%s' "$RESEND_API_KEY" | pnpm exec better-convex-nuxt-convex env set RESEND_API_KEY
pnpm exec better-convex-nuxt-convex env set RESEND_FROM_EMAIL invites@example.com
```

Load `RESEND_API_KEY` from your secret manager without printing it or placing it
in shell history.

Without Resend configured, localhost/test runs log verification and invitation
links for manual testing. Non-local deployments fail fast instead of pretending
email was sent.

Also configure the Nuxt public Convex URLs in the `.env.local` created by
`pnpm convex:configure`:

```bash
NUXT_PUBLIC_CONVEX_URL=
NUXT_PUBLIC_CONVEX_SITE_URL=
```

For non-loopback deployments, also set
`BCN_AUTH_TRUSTED_CLIENT_IP_HEADER` to a header the ingress overwrites with
exactly one client IP. Public traffic must not reach the Nuxt origin around that
ingress unless the origin independently authenticates ingress requests.
