# MCP OAuth agent starter

This starter is a complete MCP server that ChatGPT, Claude, and MCP Inspector
can connect to. A person signs in to this Nuxt application, grants access on a
consent page, and the host then calls project tools on their behalf. Convex
checks the grant and the person's organization role again in every tool call.

It follows the Better Convex agents path from end to end:

| Step                                                                                       | File                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Configure the auth factory with the MCP OAuth profile; consent text comes from the policy  | `convex/auth.ts`, `convex/policy.ts`                  |
| Say who may do what: actions, roles, MCP scopes, and which agent actions wait for a person | `convex/policy.ts`                                    |
| One row rule per table; the user and the organization role of the caller                   | `convex/functions.ts`                                 |
| Operations for the web; a `tool` field makes one an MCP tool                               | `convex/projects.ts`                                  |
| Collect the tools, approvals and activity feed with `defineTools`                          | `convex/agents.ts`                                    |
| Serve them to MCP hosts with `createMcpServer`, next to the auth routes                    | `convex/http.ts`                                      |
| List and disconnect hosts with `auth.oauthConnections`; provision host clients as operator | `convex/connections.ts`                               |
| Approve or decline an agent's request; see what agents did                                 | `app/pages/index.vue`, `app/pages/approvals/[id].vue` |
| Sign in and give consent for a verified authorization request                              | `app/pages/login.vue`, `app/pages/oauth/consent.vue`  |

## What the starter shows

- Better Auth is the OAuth authorization server. The `oauth.mcp` profile
  admits only operator-provisioned public clients with S256 PKCE, explicit
  consent, the `mcp:read` and `mcp:write` scopes, and the exact Convex `/mcp`
  resource.
- Access tokens live for at most ten minutes. With `offline_access`, a host
  receives a refresh token that ends with the Better Auth session that granted
  consent, and after at most seven days. Signing out of the app ends the
  session, so it also disconnects the person's hosts.
- The Convex HTTP action verifies each token with keys from the auth component:
  issuer, audience, algorithm, expiry, token class, and scopes. It then checks
  the live session, client, resource link, and consent in one query. The raw
  token never leaves the handler.
- A host sees only the tools of the scopes the person granted. Each tool call
  runs the tool's own internal function. It checks the grant again, then the
  app user, the organization role and every row it reads or writes, with the
  same policy and row rules as the web, in the same transaction as the effect.
  Agent writes are limited per connection and minute.
- Archiving a project is held for a person. The tool returns a link to the
  approval page; approving runs the archive as the agent, and fails if the
  project changed since the request. Owners and admins of the organization may
  decide a teammate's request.
- Every agent write appears in the organization's activity feed on the start
  page. Known failures reach the model as a code and a short message; every
  other failure becomes a generic one.

`users` is a rebuildable projection of the Better Auth user. Organizations,
memberships, projects, approvals and activity are app-owned Convex state. OAuth
clients, resources, and consents stay in the auth component.

### What one consent reaches

The starter has no per-organization or per-client delegation. One consent lets
the host act in every organization where the person has an active membership,
up to their current role in each, and in no other organization. The consent
page says so. Removing a membership or lowering a role blocks the next tool
call in that organization; disconnecting the host blocks every organization at
once.

If your product needs a narrower grant, for example a host that may act only
in one chosen workspace, add an app-owned table keyed by user, client, and
organization (with a status, an expiry, and a scope list), let the person
choose it on the consent page, and check it in `roleOf` in
`convex/functions.ts`, which every call runs in the same transaction as its
effect.

## HTTP route graph

`convex/http.ts` registers the auth routes and five MCP routes:

- `POST`, `GET`, and `DELETE` at `/mcp`;
- `GET` at `/.well-known/oauth-protected-resource/mcp`, which also serves
  `HEAD` through Convex's router; and
- `OPTIONS` at the metadata path for credential-free discovery CORS.

`GET` and `DELETE` on `/mcp` reach the handler's `405` response. The starter
does not register `OPTIONS /mcp`, so metadata discovery does not enable
cross-origin MCP transport.

## Local setup

Use a fresh deployment. This starter has no migration path from older schemas.

1. Install dependencies and create local configuration with one private proxy
   secret. The shell built-in writes it to the ignored file without printing it:

   ```bash
   pnpm install
   (
     set -eu
     if [ -e .env.local ]; then
       printf '%s\n' 'Refusing to replace existing .env.local' >&2
       exit 1
     fi
     umask 077
     BCN_AUTH_PROXY_IP_SECRET="$(openssl rand -base64 32)"
     sed '/^BCN_AUTH_PROXY_IP_SECRET=/d' .env.example > .env.local
     printf 'BCN_AUTH_PROXY_IP_SECRET=%s\n' "$BCN_AUTH_PROXY_IP_SECRET" >> .env.local
   )
   ```

2. Set the exact Nuxt origin in `.env.local`. If the fresh deployment already
   exists, fill its Convex URLs too. Otherwise run `convex:configure` once and
   then fill the remaining URL values. Do not change the generated
   `BCN_AUTH_PROXY_IP_SECRET`. The Nuxt scripts load this file explicitly.
   Never commit it.

3. Start Convex in one terminal and keep it running:

   ```bash
   pnpm convex:configure
   ```

   After `Convex functions ready!`, open another terminal. Load the ignored
   configuration into that shell, then set Convex from those exact values. The
   Better Auth secret is generated independently and is never copied into Nuxt:

   ```bash
   set -a
   . ./.env.local
   set +a
   pnpm exec better-convex convex env set SITE_URL "$SITE_URL"
   BETTER_AUTH_SECRETS="1:$(openssl rand -base64 32)"
   printf '%s' "$BETTER_AUTH_SECRETS" | pnpm exec better-convex convex env set BETTER_AUTH_SECRETS
   printf '%s' "$BCN_AUTH_PROXY_IP_SECRET" | pnpm exec better-convex convex env set BCN_AUTH_PROXY_IP_SECRET
   unset BETTER_AUTH_SECRETS
   ```

   Exact loopback development permits a blank
   `BCN_AUTH_TRUSTED_CLIENT_IP_HEADER`. Before you deploy any HTTPS origin, set
   it to one header that the ingress overwrites with exactly one client IP.
   Restrict the Nuxt origin so that public traffic cannot bypass that ingress.

   Convex supplies `CONVEX_SITE_URL` to functions as a deployment-owned
   built-in, and the starter uses its `/mcp` URL as the OAuth resource. The CLI rejects attempts to set it
   manually. `SITE_URL` must exactly match the public Nuxt origin. Now create
   the fresh deployment's first signing key before you allow auth traffic:

   ```bash
   pnpm exec better-convex convex run auth:rotateSigningKey '{}'
   ```

   On this fresh deployment, require `previousKids` to be empty and record the
   returned `newKid`. A previous key means that the deployment is not fresh.
   Stop and inventory it instead of deleting or reusing state.

4. Start Nuxt in another terminal:

   ```bash
   pnpm dev
   ```

   Fetch `http://localhost:3000/api/auth/jwks` and verify that its `keys` array
   contains the exact recorded `newKid` before you create a user or open
   ingress.

5. Create the first local Better Auth user. The starter has no public sign-up
   page. This explicit local call keeps account creation separate from the
   OAuth login page:

   ```bash
   BCN_LOCAL_ADMIN_PASSWORD="$(openssl rand -base64 24)"
   curl --fail-with-body \
     -H 'Content-Type: application/json' \
     -H 'Origin: http://localhost:3000' \
     --data-binary @- \
     http://localhost:3000/api/auth/sign-up/email <<JSON
   {"name":"Local Owner","email":"owner@example.com","password":"${BCN_LOCAL_ADMIN_PASSWORD}"}
   JSON
   ```

   Keep that generated password only in the calling shell or a test secret
   manager. It remains valid until you change the password or destroy the
   disposable account or deployment. Do not print, log, or commit it. The new
   account owns one organization.

## Connect MCP Inspector

1. Create the Inspector client as the deployment operator:

   ```bash
   pnpm exec better-convex convex run connections:createInspectorClient '{}'
   ```

   Record the returned `clientId`. The client accepts only the callback
   `http://localhost:6274/oauth/callback`.

2. Start MCP Inspector with `pnpm dlx @modelcontextprotocol/inspector`. Select
   the Streamable HTTP transport and enter your `CONVEX_SITE_URL` followed by
   `/mcp`.
3. In the OAuth settings, enter the client ID, leave the client secret empty,
   and request `mcp:read mcp:write offline_access`.
4. Connect. Sign in with the local account and allow access on the consent
   page. Then call `list_organizations` and `search_projects`.
5. Call `create_project`, then `archive_project`. Open the returned link,
   approve the request, and call `check_approval` with the approval ID.

To connect ChatGPT or Claude, deploy with an HTTPS origin and follow
[Connect ChatGPT and Claude](https://better-convex.lupinum.com/docs/build/agents/connect-chatgpt-and-claude).
Provision each host with `connections:createHostClient`.

## Login and consent boundary

The provider signs the bounded continuation query. Before either page displays
client data, the browser submits that signed value to the provider's
`/oauth2/public-client-prelogin` endpoint. The UI then renders only the
returned client ID and name, the exact Convex resource, and allowlisted scopes
from the verified transaction. It never accepts display names from query input
and cannot widen consent. Login and consent responses are no-store, deny
framing, and use a no-referrer policy.

## Tests

`pnpm test` runs the starter's own tests in `convex-test`, with the real Better
Auth component:

| File                           | Fails when                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `convex/no-bypass.test.ts`     | a function skips the policy and the row rules (not built from `./functions`) |
| `convex/leaks.test.ts`         | an operation returns or changes a project of another organization            |
| `convex/cost.test.ts`          | a call reads or writes more documents than its budget                        |
| `convex/authorization.test.ts` | a tool runs after its grant, session, membership or role ended               |

[Test your app](https://better-convex.lupinum.com/docs/build/functions/testing)
explains each one.

## Integration tests

From the repository root, run the real-backend OAuth and MCP suite:

```bash
pnpm exec vitest run --project=integration test/integration/mcp-auth.integration.test.ts
```

`pnpm test:integration` runs it together with the other real-backend suites.
The suite creates its own temporary starter copy, pinned local Convex backend,
Nuxt server, user, and random secrets. It copies
`test/fixtures/mcp-oauth-agent/evidence.ts` into that copy as
`convex/evidence.ts`. These internal functions provision test clients through
`auth.oauthOperator` and change app state between cases. They are not part of
the starter. The run removes the temporary copy when it ends.

The suite drives the authorization code flow with direct S256 PKCE for two
public clients, leaves client-secret fields empty, and validates exact
redirect, state, resource, and issuer binding. It then checks that membership
removal, role reduction, a foreign organization, user suspension, a
client-resource unlink, session deletion, client disable, client deletion, and
a disconnected connection each block the next tool call, and that a read-only
token sees and calls only read tools. It also checks the stateless MCP
protocol envelope and its error cases with the official SDK.

## Production adaptation

- Provision one client per host with `connections:createHostClient`. Do not
  accept callbacks, scopes, or resource identifiers from browser input.
- Replace the example project model with your own data: one row rule per
  table in `convex/functions.ts`, and an operation with a `tool` field for
  each action an agent may take.
- Decide which agent actions wait for a person (`agents` in the policy) and
  who may approve them (`approvers`).
- Set `SITE_URL` on the deployment: approval links point to it.
- Govern or disable public account creation.
- Terminate TLS at a trusted ingress, configure deployment-level abuse
  controls, keep Better Auth's database-backed rate limiter enabled, and never
  log cookies, codes, tokens, signed continuation queries, or authorization
  headers.
- Rotate versioned Better Auth secrets, the proxy-IP signing secret, and OAuth
  signing keys according to the deployment runbook.

The profile does not enable dynamic registration, CIMD, DPoP, client
credentials, private-key client authentication, introspection, UserInfo, or
OIDC scopes. Do not enable one of them only to satisfy an unsupported client.

OAuth access tokens are self-contained JWTs with a maximum ten-minute lifetime.
Deleting a session or consent, disabling or deleting a client, disabling or
deleting the resource, unlinking the resource, or changing a membership or role is checked
live and blocks the next tool call. Revoking one already-issued JWT at the
token endpoint has a residual window until its `exp`; disconnect the host to
revoke its access immediately.

## Verification

The maintained candidate must pass codegen, typecheck, build, security tests,
the clean-tarball candidate matrix, both real OAuth client paths, and the
official MCP server-mode suite:

```bash
pnpm test
pnpm convex:codegen
pnpm typecheck
pnpm build
```

The `0.0.0` versions of `@lupinum/better-convex-functions` and
`@lupinum/better-convex-agents` in `package.json` are placeholders: neither
package is on npm yet, so this starter cannot be installed from npm before
their first release, with or without `--frozen-lockfile`. The repository
checks (`pnpm test:starters`) install the packed workspace packages in their
place. `pnpm-lock.yaml` still records the last published tuple, with
`@lupinum/better-convex-mcp`. After the first release, the pins move to the
released version and the lockfile is regenerated in the same change.
Better Auth owns its Kysely runtime; this starter does not add a standalone
Kysely dependency.
