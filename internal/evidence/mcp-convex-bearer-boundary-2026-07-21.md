# Convex-native canonical bearer boundary — 2026-07-21

## Scope

This closes private-lab task `P1-012`. It proves that Candidate A has one bearer-consuming Convex HTTP
action and no path that forwards an MCP bearer into a general Convex query, mutation, action, or
application argument.

The trace marker is private test instrumentation. It records only that the canonical verifier boundary
ran; it contains no token, subject, client, resource, authorization reference, or error detail.

## Executed route trace

The freshly deployed Convex fixture adds `x-bcn-lab-bearer-boundary: canonical-mcp` only after a request
enters `requireLabOAuthAccess` in the fixed `POST /mcp` handler.

Executed outcomes:

| Request carrying or attempting credentials                | Status | Canonical verifier marker |
| --------------------------------------------------------- | -----: | ------------------------- |
| `POST /mcp`, missing bearer                               |  `401` | present                   |
| `POST /mcp`, each invalid token class/binding             |  `401` | present                   |
| `POST /mcp`, valid bearer and initialize                  |  `200` | present                   |
| protected-resource metadata with valid bearer header      |  `200` | absent                    |
| hostile-Origin `POST /mcp` rejected before authentication |  `403` | absent                    |
| `POST /mcp/extra` with valid bearer                       |  `404` | absent                    |
| removed `/api/auth/get-session` path with valid bearer    |  `404` | absent                    |

The fixture now uses provider-neutral function readiness and deletes the former fake Better Auth health
route. Its HTTP router contains one `handleMcp` registration, and only `mcp.ts` imports/calls the OAuth
access verifier.

## General-function negatives

Against the same deployed backend:

- calling `operations:searchNotes` through `ConvexHttpClient` fails because the canonical application
  operation is internal;
- calling the HTTP action reference `mcp:handleMcp` through `ConvexHttpClient` fails because an HTTP
  action is not a public Convex action;
- adding an `authorization` argument containing the valid lab bearer to the public fixture-control
  mutation fails Convex validation as an extra field; and
- the application operations source contains no `AuthInfo`, `Request`, authorization, bearer, or token
  surface. The MCP action projects verified access to the frozen `{ subject }` application principal.

The official MCP clients continued to pass all tools, resources, live role change, cross-tenant denial,
streaming, framing, timeout, abort, and concurrency checks. Captured MCP response bodies contain none of
the deterministic lab token sentinels.

## Reproduction

```sh
pnpm exec vitest run --config internal/labs/mcp-topology/convex/vitest.config.ts
pnpm exec eslint internal/labs/mcp-topology/convex
pnpm exec vue-tsc --noEmit --project tsconfig.json
```

Result on 2026-07-21: the production-deployed Convex fixture passed the complete test, including route
trace and direct-function negatives. No auth route, database trace table, bearer fingerprint, or token
logging was added.

## Boundary of the claim

The OAuth verifier still uses deterministic private-lab token records; Phase 5 must prove real Better
Auth and external authorization-server cryptography. This evidence establishes routing and provenance,
not production token cryptography or the final topology decision.
