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

## Run it locally

1. Install the dependencies. If pnpm stops with `ERR_PNPM_IGNORED_BUILDS`, run
   `pnpm approve-builds`, allow `esbuild`, and install again.

   ```bash
   pnpm install
   ```

2. Create a Convex development deployment. Choose a new project when asked.
   The command writes `.env.local` and keeps watching; stop it with Ctrl+C
   after it reports that the Convex functions are ready.

   ```bash
   pnpm convex:configure
   ```

3. Nuxt reads other names than the ones `convex:configure` writes. Add these
   lines to `.env.local`, with the values of `VITE_CONVEX_URL` and
   `VITE_CONVEX_SITE_URL` from the same file:

   ```bash
   NUXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
   NUXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
   SITE_URL=http://localhost:3000
   ```

   `SITE_URL` is the Nuxt origin. If you run Nuxt on another port, change it
   here and in the next step.

4. Set the auth origin and both independent secrets in Convex:

   ```bash
   export BCN_AUTH_PROXY_IP_SECRET="$(openssl rand -base64 32)"
   (
     set -eu
     umask 077
     sed '/^BCN_AUTH_PROXY_IP_SECRET=/d' .env.local > .env.local.next
     printf 'BCN_AUTH_PROXY_IP_SECRET=%s\n' "$BCN_AUTH_PROXY_IP_SECRET" >> .env.local.next
     mv .env.local.next .env.local
   )
   pnpm exec better-convex convex env set SITE_URL http://localhost:3000
   printf '0:%s' "$(openssl rand -base64 32)" | pnpm exec better-convex convex env set BETTER_AUTH_SECRETS
   printf '%s' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex convex env set BCN_AUTH_PROXY_IP_SECRET
   ```

5. Create the fresh deployment's first signing key. Without it, sign-in fails
   with `AUTH_JWKS_OPERATOR_SETUP_REQUIRED`:

   ```bash
   pnpm exec better-convex convex run auth:rotateSigningKey '{}'
   ```

   On a fresh deployment the result has an empty `previousKids`. A previous
   key means the deployment is not fresh: stop and check it instead of
   reusing state.

6. Start Convex and Nuxt in two terminals:

   ```bash
   pnpm convex:dev
   pnpm dev
   ```

7. Open <http://localhost:3000/agency>. Create an account, then sign in.

8. Under **New organization**, create one organization of kind **Agency** and
   one of kind **Client**. Each creation shows the new organization ID. The
   agency ID fills the **Agency organization id** field.

9. Link the client to the agency as the operator. The starter has no public
   operation for this on purpose (see [Non-goals](#non-goals)): in a real
   product, both organizations must agree first. For local testing, import one
   link row with the two IDs:

   ```bash
   now=$(date +%s000)
   cat > link.json <<JSON
   [{ "agencyOrganizationId": "<agency id>", "clientOrganizationId": "<client id>",
      "status": "active", "createdAt": $now, "updatedAt": $now }]
   JSON
   pnpm exec convex import --table organizationLinks --append link.json
   ```

10. The client appears in the list on `/agency`. Open it to see the client
    workspace and create a project there.

Checks:

```bash
pnpm test
pnpm typecheck
```

Use `pnpm convex:dev` after `.env.local` exists; it selects only the deployment
recorded in that file.

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
