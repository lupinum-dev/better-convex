# MCP OAuth agent starter

This starter is a complete MCP server that ChatGPT, Claude, and MCP Inspector
can connect to. A person signs in to this Nuxt application, grants access on a
consent page, and the host then calls project tools on their behalf. Convex
checks the grant and the person's organization role again in every tool call.

It follows the Better Convex MCP path from end to end:

| Step                                                                                           | File                                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Configure the auth factory with the MCP OAuth profile                                          | `convex/auth.ts`                                     |
| Mount the auth routes and the MCP routes                                                       | `convex/http.ts`                                     |
| Handle MCP with one `handleMcpRequest` and the Better Auth verifier                            | `convex/mcp.ts`                                      |
| Define each tool with `registerMcpTool`; pass the typed principal to one internal mutation     | `convex/mcp.ts`                                      |
| Call `auth.requireMcpPrincipal` inside the mutation, then check app roles                      | `convex/projects.ts`                                 |
| List and disconnect hosts with `auth.oauthConnections`; provision host clients as the operator | `convex/connections.ts`                              |
| Let a person approve or decline a destructive request                                          | `convex/approvals.ts`, `app/pages/index.vue`         |
| Sign in and give consent for a verified authorization request                                  | `app/pages/login.vue`, `app/pages/oauth/consent.vue` |

## What the starter shows

- Better Auth is the OAuth authorization server. The `oauth.mcp` profile
  admits only operator-provisioned public clients with S256 PKCE, explicit
  consent, the `mcp:read` and `mcp:write` scopes, and the exact Convex `/mcp`
  resource.
- Access tokens live for at most ten minutes. With `offline_access`, a host
  receives a refresh token that ends with the Better Auth session that granted
  consent, and after at most seven days.
- The Convex HTTP action verifies each token with keys from the auth component:
  issuer, audience, algorithm, expiry, token class, and scopes. It then checks
  the live session, client, resource link, and consent in one query. The raw
  token never leaves the handler.
- Each tool call runs one internal mutation. The mutation re-checks the grant
  and the tool's scope with `auth.requireMcpPrincipal`, then checks the app
  user, the organization membership and role, project ownership, and a
  per-user, per-client rate limit, in the same transaction as the effect.
- Deletion is soft and needs a short-lived approval. A person grants it in the
  application for one project, one user, and one client. It can be used once.
- Known failures reach the model as structured errors with a code and a short
  message. Every other failure becomes `Tool execution failed`.

`users` is a rebuildable projection of the Better Auth user. Organizations,
memberships, projects, and approvals are app-owned Convex state. OAuth clients,
resources, and consents stay in the auth component.

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
choose it on the consent page, and check it in `authorize()` in
`convex/projects.ts` in the same transaction as the membership check.

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
   page. Then call `list_organizations` and `list_projects`.
5. Call `create_project`, then `request_project_deletion`. Approve the request
   on the start page, and call `delete_project` with the returned approval ID.

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
a disconnected connection each block the next tool call. A read-only token
receives the `mcp:write` step-up challenge. It also checks the stateless MCP
protocol envelope and its error cases with the official SDK.

## Production adaptation

- Provision one client per host with `connections:createHostClient`. Do not
  accept callbacks, scopes, or resource identifiers from browser input.
- Replace the example project model with your own data. Keep one internal
  function per tool, and call `auth.requireMcpPrincipal` in it before any
  effect.
- Decide who may approve destructive requests. The start page lists pending
  deletions for organization owners and admins; adapt `approvals:listPending`
  and its page to your roles and operations.
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
pnpm convex:codegen
pnpm typecheck
pnpm build
```

The committed `package.json` pins the last published tuple: Better Auth and
OAuth Provider `1.7.2`, Convex `1.42.2`, Better Convex Nuxt `1.0.0-beta.3`,
`@lupinum/better-convex-mcp@1.0.0-beta.2`, and official MCP server SDK `2.0.0`.
This source already uses the `1.0.0-rc.0` API. The repository checks build it
against the `1.0.0-rc.0` Nuxt and MCP candidates with Better Auth `1.7.6` and
MCP server SDK `2.1.0`. The pins move to that tuple after `1.0.0-rc.0` is
published.
Better Auth owns its Kysely runtime; this starter does not add a standalone
Kysely dependency.
