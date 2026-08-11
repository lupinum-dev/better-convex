# Runtime architecture

This document records the current ownership and invariants of the published
runtime. Public usage belongs in the generated API reference and guides.

## Sources of truth

| Concept                                                  | Owner                                       |
| -------------------------------------------------------- | ------------------------------------------- |
| Better Auth sessions and users                           | Better Auth                                 |
| OAuth protocol clients, resources, consent, and tokens   | Official Better Auth OAuth Provider         |
| Application authorization and product data               | Convex functions                            |
| Public auth/OAuth origin                                 | Explicit validated application config       |
| JWT signing keys and rotation                            | One Better Auth JWKS graph in the component |
| Active browser Convex client                             | Per-Vue-root Better Convex runtime          |
| Auth transitions and identity generation                 | Provider-neutral Vue auth adapter/runtime   |
| Query transport, wire deduplication, and transport cache | Pinned Convex client                        |
| SSR payload and Vue-visible query state                  | Each query composable                       |
| Public error shape and normalization                     | `better-convex-vue/errors`                  |
| Public runtime configuration                             | Module schema and runtime config normalizer |

The module does not maintain a second session store, authorization model,
subscription registry, or raw-client public surface.

## Module graph

The Nuxt client plugin installs one `better-convex-vue` runtime per Nuxt
application. When auth is enabled, the Better Auth adapter supplies only a
provider-neutral session snapshot and token callback; the Vue runtime owns
client replacement and identity generations. The server plugin exchanges the
request session once and hydrates the canonical identity state before page
setup.

Omitting `auth` excludes the auth client plugin, server auth plugin, auth proxy,
auth middleware, auth composable, and auth-only type generation from the
generated application. `auth: false` is the explicit Nuxt-layer tombstone for
removing inherited auth configuration.

## Client ownership

`packages/vue/src/internal/client-owner.ts` is the only code that creates,
replaces, and closes browser Convex clients. Consumers receive a stable handle
containing exactly `query`, `mutation`, `action`, and `onUpdate`. The handle
never exposes client lifecycle methods.

An identity change retires operations bound to the previous generation,
rebinds active listeners to the replacement client, publishes that client, and
then closes the retired client. Anonymous calls use the anonymous transport
selected by the canonical query execution gate.

## Authentication

The Vue runtime serializes identity-changing operations and owns the identity
generation. A provider adapter reports settled authentication snapshots and
supplies short-lived tokens without receiving a raw Convex client. Session
observation, token refresh, sign-in, and sign-out all converge on that single
runtime. Operation progress is separate from settled identity state.

The browser talks to Better Auth only through the fixed same-origin
`/api/auth` proxy. The proxy accepts GET and POST, validates origin and body
limits, forwards only selected headers, rejects unsafe cookie attributes, and
uses bounded request and response bodies. Its only cross-origin exceptions are
non-credentialed public metadata reads and the fixed public-client OAuth token
POST/OPTIONS profile. Development diagnostics are best-effort and cannot
change proxy success or failure.

Better Auth establishes identity. Convex functions still enforce every
authorization rule from canonical backend state.

Delegated MCP traffic enters the deployment-owned Convex HTTP Action directly.
The official-SDK-backed `better-convex-mcp` handler is the only bearer verifier;
the Nuxt package owns no MCP relay or protocol parser. Explicit application tool
registrations map to named internal operations. Each effect recomputes access
from current provider and application state; token scopes are only a ceiling.

## Query lifecycle

Each query composable owns its Vue state, listener, SSR payload key, and
cleanup. Convex owns transport-level subscription deduplication; the provider
contract test pins that behavior for the exact Convex peer version.

Payload keys include function name, argument hash, auth mode, and—except for
public `none` queries—the current identity key. Identity changes clear
identity-owned state synchronously. Public queries remain identity-independent.

The execution gate is the only place that combines auth mode and auth status.
It returns one terminal decision: wait, skip, primary transport, anonymous
transport, or error.

## Calls and errors

Mutations and actions use the shared callable lifecycle and reject through
ordinary `await`/`catch`. Every failure passes through the same normalizer.
`ConvexCallError` is the only public error class and the `/errors` export
remains framework-free.

Server calls are request-scoped. `serverConvex(event)` owns one lazy token
promise and one HTTP client per caller. Authenticated callers must never be
stored globally or shared between requests.

## Derived state

Nuxt payload data, query state, and optional user projections are derived.
They must be partitioned by identity where applicable and reproducible from
canonical Better Auth or Convex state. `createUserProjectionTriggers` includes a
rebuild path; projections must not become an authorization source.

## Release artifact fingerprint

The release packer replaces one build-output token with a random fingerprint in
both the packed Nuxt module and a read-only Nitro handler. Only a module carrying
a valid packed fingerprint registers
`/api/_better-convex-nuxt/release-fingerprint`; ordinary source and development
builds remain unbound and do not register it. The response contains only the
fixed schema version and embedded fingerprint—never environment, deployment, or
secret data. This route exists solely to let the protected release gate reject a
stale provider-hosted Nuxt build before staging writes; it is not an application
identity or authorization source.

## Public boundaries

The supported package entry points are:

- `better-convex-vue`
- `better-convex-vue/errors`
- `better-convex-vue/embedded`

- `better-convex-nuxt`
- `better-convex-nuxt/auth-client`
- `better-convex-nuxt/convex-auth`
- `better-convex-nuxt/convex-auth/convex.config`
- `better-convex-nuxt/convex-auth/_generated/component.js`
- `better-convex-nuxt/convex-auth/test`
- `better-convex-nuxt/errors`
- `better-convex-nuxt/server`

Anything else under `src/runtime` is internal. Internal files may change
without compatibility wrappers; released exports and documented behavior
require normal semver treatment.

## Invariant tests

The permanent suite protects:

- package exports, declarations, packed purity, and consumer type resolution;
- the pinned Convex provider's identical-subscription wire deduplication;
- auth identity changes, stale-operation retirement, and multi-app isolation;
- query auth modes, identity-partitioned payload state, and pagination;
- request-scoped server callers and auth proxy security boundaries;
- public errors and ordinary rejected-call normalization;
- Better Auth provider and user-sync contracts.

Migration mechanics and deleted implementation details are not compatibility
contracts.
