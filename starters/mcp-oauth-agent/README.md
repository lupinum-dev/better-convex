# Delegated human OAuth MCP starter

This starter is the public, delegated-human MCP model. Better Auth is the OAuth
authorization server, Better Convex Nuxt exposes it through the same-origin
`/api/auth` proxy, and the deployment-owned Convex `/mcp` HTTP Action accepts
short-lived OAuth access tokens. Convex remains the product-authorization authority.

It is a delegated-human example, not a universal machine-identity model. For
controlled service automation, supply a provider-neutral bearer verifier to
`@lupinum/better-convex-mcp` and keep credential state and authorization in the
application. Do not combine service credentials with this OAuth profile or add
an `MCP_SERVER_SECRET` bridge.

## What the starter proves

- Better Auth and its OAuth Provider use the same Convex component adapter and
  canonical component database. There is no second OAuth table set.
- OAuth supports only authorization code, mandatory PKCE, exact HTTPS or RFC
  8252 loopback-IP redirects, explicit consent, the fixed
  `mcp:read`/`mcp:write` scopes, and the exact Convex HTTP Actions `/mcp` resource.
- There is no Nuxt MCP relay. The official MCP SDK and `@lupinum/better-convex-mcp`
  terminate the bearer in one deployment-owned Convex HTTP Action.
- The action verifies the issuer, resource, token class, algorithm, subject,
  session, client, and scopes. Five explicit official-SDK registrations map to
  five tool-specific internal mutations and never pass the raw token onward.
- Each tool transaction re-reads the active Better Auth session, OAuth client,
  resource link, consent, app user, organization membership, delegation,
  resource ownership, and approval state before reading or changing product
  data. Token scopes are only a ceiling.
- Project deletion remains soft, previewable, and bound to a short-lived human
  approval that can be used only once.

`users` is a rebuildable app projection of the canonical Better Auth user. The
`oauthAdmin` bit, organizations, memberships, delegations, projects, and
approvals are app-owned Convex state. OAuth client/resource/consent rows remain
provider-owned component state.

## HTTP route graph

The OAuth resource has exactly five registrations in `convex/http.ts`:

- `POST`, `GET`, and `DELETE` at `/mcp`;
- `GET` at `/.well-known/oauth-protected-resource/mcp`, which also serves
  `HEAD` through Convex's router; and
- explicit `OPTIONS` at the metadata path for credential-free discovery CORS.

`GET` and `DELETE` on `/mcp` deliberately reach the MCP handler's `405`
response. The starter does not register `OPTIONS /mcp`, so metadata discovery
does not accidentally enable cross-origin MCP transport.

## Local setup

Use a fresh deployment. This starter is greenfield and intentionally contains
no legacy component migration or compatibility path.

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
   exists, fill its Convex URLs too; otherwise run `convex:configure` once and
   then fill the remaining URL values. Do not change the
   generated `BCN_AUTH_PROXY_IP_SECRET`. The Nuxt scripts load this file
   explicitly. Never commit it.

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
   `BCN_AUTH_TRUSTED_CLIENT_IP_HEADER`. Before deploying any HTTPS origin, set
   it to one header the ingress overwrites with exactly one client IP. Restrict
   the Nuxt origin so public traffic cannot bypass that ingress, or independently
   authenticate ingress requests at the origin.

   Convex supplies `CONVEX_SITE_URL` to functions as a deployment-owned built-in
   and uses its exact `/mcp` URL as the OAuth resource;
   the CLI rejects attempts to set it manually. Keep the selected deployment's
   generated value in `.env.local` for Nuxt, but set only the application-owned
   variables above. `SITE_URL` must exactly match the public Nuxt origin. Now
   create the fresh deployment's first signing key before allowing auth traffic:

   ```bash
   pnpm exec better-convex convex run auth:rotateSigningKey '{}'
   ```

   On this fresh deployment, require `previousKids` to be empty and record the
   returned `newKid`. A previous key means the deployment is not fresh; stop and
   inventory it instead of deleting or reusing state.

4. Start Nuxt in another terminal:

   ```bash
   pnpm dev
   ```

   Fetch `http://localhost:3000/api/auth/jwks` and verify that its `keys` array
   contains the exact recorded `newKid` before creating a user or opening
   ingress.

5. Create the first local Better Auth user. The starter has no public sign-up
   page; this explicit local bootstrap call keeps account creation separate
   from the OAuth login page:

   ```bash
   BCN_LOCAL_ADMIN_PASSWORD="$(openssl rand -base64 24)"
   curl --fail-with-body \
     -H 'Content-Type: application/json' \
     -H 'Origin: http://localhost:3000' \
     --data-binary @- \
     http://localhost:3000/api/auth/sign-up/email <<JSON
   {"name":"Local OAuth Admin","email":"admin@example.com","password":"${BCN_LOCAL_ADMIN_PASSWORD}"}
   JSON
   ```

   Keep that generated password only in the calling shell or a test secret
   manager. It remains valid until you change the password or destroy the
   disposable account or deployment; do not print, log, or commit it.

6. Grant that projected user the app-owned OAuth administrator capability from
   the trusted Convex CLI or dashboard operator context:

   ```bash
   pnpm exec better-convex convex run mcpAdmin:setOAuthAdministratorByEmail \
     '{"email":"admin@example.com","enabled":true}'
   ```

The administrator bit does not grant organization access. It only allows the
provider's client/resource administration callbacks. Missing users, inactive
users, ordinary sessions, callback errors, and callback timeouts deny the
operation.

## Provider-owned fixture provisioning

The interoperability runner signs in as the bootstrapped administrator and
calls `/api/auth/mcp/admin/provision`. That authenticated endpoint dispatches
the OAuth Provider's own resource-list/create, client-list/create, and
client-resource-link endpoints. It never writes OAuth component models through
the raw adapter.

The provider generates the client IDs. Stable `software_id` values let a rerun
find the preregistered fixture profiles without creating a second source of truth.
The release runner uses two independent public clients through direct S256 PKCE;
legacy profile names remain fixture identifiers, not release-tool dependencies:

- MCP Inspector: `http://localhost:6274/oauth/callback`;
- `mcp-remote`: `http://127.0.0.1:3334/oauth/callback`.

Every stored field is compared with the fixed profile. A duplicate profile or
any drift in callbacks, grants, scopes, PKCE, consent, DPoP, client type, token
authentication, or resource policy fails closed. App-owned 24-hour fixture
delegations are created only after the provider operations succeed.

From the repository root, run the black-box interoperability harness:

```bash
pnpm test:mcp-auth
```

That default command creates its own temporary starter copy, pinned local
Convex backend, Nuxt server, administrator, and random secrets. It removes only
that self-contained temporary fixture when the run ends.

The harness drives the authorization code flow directly for both public clients,
leaves client-secret fields empty, rejects dynamic registration, validates exact
redirect/state/resource/issuer binding, redacts authorization URLs and runner
secrets, and removes its isolated client state after every run.

### External disposable deployment evidence

An already-running deployment can be exercised only through the explicit
`external-disposable` mode. This is a destructive, one-run release-evidence
path, not a development convenience and never a production or shared staging
check. Start from a fresh deployment and a fresh administrator account. Deploy
this exact starter, keep Nuxt running at the supplied origin, and ensure the
absolute app directory contains `.env.local` with exact matching `SITE_URL`,
`CONVEX_URL`, `CONVEX_SITE_URL`, `NUXT_PUBLIC_CONVEX_URL`, and
`NUXT_PUBLIC_CONVEX_SITE_URL` values. Its owner-only file (for example, mode 0600) must select the same managed Convex deployment through a canonical `dev:`
or `preview:` `CONVEX_DEPLOYMENT` value and must not contain another Convex CLI
authority or override. The disposable app must not have a sibling `.env` file.
The account must already exist, use a password of at least 15 characters, and
have `oauthAdmin` enabled.
The deployment must already have completed the fresh signing-key ceremony above,
and the recorded `newKid` must be visible through this exact app origin's
`/api/auth/jwks` endpoint.

```bash
BCN_MCP_TEST_MODE=external-disposable \
BCN_MCP_TEST_APP_DIR=/absolute/path/to/fresh-mcp-oauth-agent \
BCN_MCP_TEST_ORIGIN=https://fresh-app.example.test \
BCN_MCP_TEST_CONVEX_URL=https://gentle-otter-123.convex.cloud \
BCN_MCP_TEST_CONVEX_SITE_URL=https://gentle-otter-123.convex.site \
BCN_MCP_TEST_EMAIL=mcp-evidence@example.test \
BCN_MCP_TEST_PASSWORD="${BCN_LOCAL_ADMIN_PASSWORD:?set the generated disposable-admin password}" \
pnpm test:mcp-auth
```

The runner does not provision, deploy, stop, reset, or delete the external app
or deployment. Its release hook removes only its private temporary CLI
authority directory. During evidence it
does provision provider-owned test clients and app delegations, changes and
deletes sessions, clients, and consents, changes membership and authorization
state, and creates and soft-deletes projects. Terminal-revocation cases are not
restored. Treat the deployment as consumed after the run and destroy it using
the deployment owner's reviewed process. A rerun is not supported evidence.
Before the first Convex mutation, the repository-pinned absolute CLI resolves
the deployment in an isolated temporary directory and must report the exact
managed origins plus a `dev` or `preview` deployment type. Subsequent calls run
from the supplied app directory with both the validated deployment name and the
private generated env file passed explicitly; the CLI cannot auto-load the
app's dotenv files. Fixture credentials and every case variant of an ambient
Convex override are stripped from every child process environment.

The selected MCP protocol suite is a one-shot alternative
entry to the same destructive harness. On a fresh external deployment, use the
exact environment block above but replace its final command with:

```bash
pnpm test:mcp-conformance
```

That command runs the complete OAuth/MCP evidence and the selected protocol
scenarios in one fixture lifecycle, using the freshly issued least-scope bearer
internally. Do not run `test:mcp-auth` first and do not run both commands against
one deployment; either run consumes it. This validates the stable-SDK request
envelope with the official server package and retains the older official
conformance package only for its published `2025-11-25` scenarios. It is not
OAuth certification or OAuth conformance.

## Login and consent boundary

The provider signs the bounded continuation query. Before either page displays
client data, the browser submits that signed value to the provider's
`/oauth2/public-client-prelogin` endpoint. The UI then renders only the returned
client ID/name plus the exact deployment-owned Convex resource and allowlisted scopes from
the verified transaction. It never accepts display names from query input and
cannot widen consent. Login and consent responses are no-store, deny framing,
and use a no-referrer policy.

## Production adaptation

The two localhost clients and the 24-hour fixture delegation are test fixtures,
not a generic client-registration product. For production:

- replace the fixed profiles with reviewed client names, exact HTTPS callbacks,
  exact scopes, and an operator-owned app grant workflow;
- keep requesters from supplying restricted OAuth fields, resource identifiers,
  callbacks, or consent-bypass settings;
- continue using provider admin endpoints for OAuth rows and app mutations for
  product grants; never add direct OAuth adapter writes;
- govern or disable public account creation and use a reviewed operator process
  for setting `oauthAdmin`;
- revoke bootstrap administrator capability when it is no longer needed;
- terminate TLS at a trusted ingress, configure deployment-level abuse controls,
  keep Better Auth's database-backed rate limiter enabled, and never log
  cookies, codes, tokens, signed continuation queries, or authorization headers;
- rotate versioned Better Auth secrets, the proxy-IP signing secret, and OAuth
  signing keys according to the deployment runbook.

The beta deliberately does not enable refresh tokens, dynamic registration,
CIMD, DPoP, client credentials, private-key client authentication,
introspection, UserInfo, or OIDC scopes. Do not enable one merely to satisfy an
unsupported client.

OAuth access tokens are self-contained JWTs with a maximum ten-minute lifetime.
Deleting a session or consent, disabling a client/resource, unlinking the
resource, or changing membership/delegation is checked live and blocks the next
tool call. Revoking only one already-issued JWT has a residual window until its
`exp`; the starter does not claim immediate individual-token revocation.

## Verification

The maintained candidate must pass codegen, typecheck, build, security tests,
the clean-tarball candidate matrix, both real OAuth client paths, and the
official MCP server-mode suite:

```bash
pnpm convex:codegen
pnpm typecheck
pnpm build
```

The supported tuple is exact: Better Auth and OAuth Provider `1.7.0-rc.2`,
Convex `1.42.2`, Better Convex Nuxt `1.0.0-beta.1`,
`@lupinum/better-convex-mcp@1.0.0-beta.1`, and official MCP server SDK `2.0.0`.
Better Auth owns its Kysely runtime; this starter does not add a standalone
Kysely dependency.
