# Agency Starter

Starter for agencies that manage multiple client workspaces.

## Organization Ownership

This starter intentionally uses app-owned Convex `organizations` and
`memberships` tables so it can model agency/client delegation through explicit
`organizationLinks`.

It does not enable the Better Auth Organization plugin. If you enable Better
Auth Organization, remove independent org/member truth from this starter and
keep only domain records keyed by Better Auth organization ids plus any
derived projections that have trigger and rebuild tests.

## Includes

- agency and client organizations;
- memberships scoped to one organization;
- explicit agency-client links;
- delegated client project access;
- audit events that record delegated project creation and link revocation with
  `direct` or `delegated` access paths;
- Better Auth email/password endpoints registered through Convex HTTP Actions.
- Better Auth create/update triggers for app-owned user actors, with a bounded
  projection rebuild operation.

## Non-goals

- no nested tenants;
- no global agency superuser;
- no MCP;
- no agents;
- no shared B2B package yet.

Active links are operator-approved canonical grants. This starter deliberately
ships no public self-link operation: establish a link only through an
application ceremony that proves authorization from both tenant sides.

## Commands

```bash
pnpm install
pnpm convex:configure
pnpm dev
pnpm test
pnpm typecheck
```

Use `pnpm convex:dev` after `.env.local` exists; it selects only the deployment
recorded in that file.

Set the auth origin and both independent secrets before starting the auth routes:

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

`SITE_URL` must be the exact public Nuxt origin, without a path, query, or
fragment. In production, inject the same `BCN_AUTH_PROXY_IP_SECRET` into Nuxt
with your secret manager. Do not print or commit it.
Production startup fails closed when required values are missing.
Outside exact loopback development, set
`BCN_AUTH_TRUSTED_CLIENT_IP_HEADER` to a header your ingress overwrites with
exactly one client IP. Public traffic must reach the Nuxt origin only through
that ingress, or the origin must independently authenticate ingress requests.

Better Auth is the identity source of truth. The app-owned `users` row is the
stable domain actor referenced by organizations and audit events; only its
display name and email are derived. `auth:rebuildUserProjectionBatch` rebuilds
those fields from Better Auth in pages of 100. Invoke the internal mutation from
operator-only maintenance code, starting with a `null` cursor and repeating
with `continueCursor` until `isDone` is true. Auth deletion intentionally keeps
the domain actor row so historical references remain valid while clearing its
derived name and email. If duplicate actor rows exist for one Better Auth
subject, triggers and rebuilds fail closed rather than deleting or modifying a
potentially referenced actor. Reconcile those references explicitly before
retrying the rebuild.
