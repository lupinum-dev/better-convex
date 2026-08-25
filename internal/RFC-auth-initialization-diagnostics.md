# RFC: Value-free auth initialization diagnostics

- Status: Draft proof; no runtime change approved
- Date: 2026-08-25
- Target: Post-1.0 supportability improvement; not a release prerequisite
- Scope: Convex operator diagnostics for `createBetterConvexAuth`
- Decision owner: Better Convex maintainers

## Summary

Better Convex currently maps every auth initialization failure to `AUTH_CONFIG_INVALID`. This is the correct public failure, but it gives an operator no safe indication of which initialization stage failed.

This RFC proposes a time-boxed proof for five fixed, value-free stage labels in the existing Convex operator log. The public error remains byte-for-byte unchanged. The reporter receives no caught value, context, metadata, or configuration.

This is not an error catalog, callback, telemetry system, public API, or recovery path. It does not use `nostics` and does not amend the build-only ownership defined in `internal/RFC-nostics.md`.

## Decision requested

Approve a proof of one private reporter inside the existing auth factory:

```text
failed library-controlled stage
  -> one constant operator log line
  -> unchanged AUTH_CONFIG_INVALID failure
```

Adopt the proof only if it:

1. reports exactly one fixed label for one failed initialization attempt;
2. never reads, classifies, serializes, or forwards the caught value;
3. preserves every public HTTP and caller error;
4. adds no option, export, dependency, channel, state, or retry behavior;
5. cannot change the auth failure when logging itself fails.

If a useful diagnostic requires dynamic values or a new channel, reject this RFC.

## Context

`createBetterConvexAuth` currently collapses failures from:

- `SITE_URL` validation;
- `CONVEX_SITE_URL` validation;
- versioned secret validation;
- request-scoped OAuth profile resolution;
- feature and social provider construction;
- Better Auth construction;
- Better Auth context initialization.

The broad public failure prevents raw provider messages, environment values, secrets, and stacks from crossing the auth boundary. That behavior must remain.

The problem is operator support. A malformed origin, malformed secret set, failing OAuth profile callback, and unknown upstream initialization failure are operationally different, but all currently look identical in the server log unless an operator reproduces and isolates the factory manually.

## Existing ownership

Better Convex already has distinct failure systems:

| Concern                                  | Owner                                 |
| ---------------------------------------- | ------------------------------------- |
| Public Convex operation failures         | `ConvexCallError`                     |
| Auth proxy protocol failures             | Existing bounded HTTP codes           |
| Runtime activity                         | Existing semantic logger and DevTools |
| Build and Nuxt configuration diagnostics | `internal/RFC-nostics.md` proof       |
| Auth initialization stage                | This proposed private operator label  |

One failure must not be reported through two Better Convex systems.

The proposed label exists only because the auth factory runs inside the Convex backend and its public error must remain intentionally opaque. It does not become a general runtime diagnostic facility.

## Proposed stages

The proof may emit only these labels:

| Label                                | Stage that failed                                               |
| ------------------------------------ | --------------------------------------------------------------- |
| `BCN_AUTH_INIT_SITE_ORIGIN_FAILED`   | Validate `SITE_URL`                                             |
| `BCN_AUTH_INIT_CONVEX_ORIGIN_FAILED` | Validate `CONVEX_SITE_URL`                                      |
| `BCN_AUTH_INIT_SECRETS_FAILED`       | Validate `BETTER_AUTH_SECRETS`                                  |
| `BCN_AUTH_INIT_OAUTH_PROFILE_FAILED` | Resolve or validate the request-scoped OAuth profile            |
| `BCN_AUTH_INIT_COMPOSITION_FAILED`   | Construct plugins or Better Auth, or initialize `auth.$context` |

These names identify the executing stage. They do not claim to identify the root cause.

The composition stage deliberately groups all Better Auth, provider, plugin, and unknown failures. More detailed upstream classification would require inspecting an untrusted caught value and is outside this RFC.

## Reporting contract

The reporter writes exactly one constant string argument:

```text
[better-convex-nuxt] BCN_AUTH_INIT_SECRETS_FAILED
```

It must:

- use the existing Convex operator log through `console.error`;
- accept only the closed stage label type;
- accept no second argument;
- receive no `unknown`, `Error`, metadata, or context parameter;
- catch and ignore a failure from a replaced or throwing console;
- run once at the lowest shared boundary;
- stay silent on successful initialization.

OAuth profile resolution must report inside the shared resolver used by normal auth creation and the OAuth operator. Auth composition must report inside the shared construction path. Outer HTTP and operator catches must not report again.

No global deduplication is proposed. Each failed construction attempt produces one line. Rate limiting, sampling, persisted counters, and logged-once state would add new sources of truth and could hide repeated operational failure.

## Public boundary

The following behavior must remain unchanged:

- public status codes;
- the `{ code: 'AUTH_CONFIG_INVALID' }` response;
- thrown error messages received by current factory and operator callers;
- auth proxy error shapes;
- `ConvexCallError`;
- SSR payloads and DevTools events;
- package exports and types.

The stage label must not enter:

- an error message, `cause`, or data field;
- an HTTP body or header;
- an SSR payload;
- a browser bundle;
- a DevTools event;
- application telemetry;
- an application callback;
- stored state.

The fixed source string can exist in the packaged Convex server code. Absence from the npm tarball is not a meaningful security requirement.

## Security rules

The reporter must never receive or inspect:

- origins or URLs;
- environment names or values;
- secrets or versioned secret material;
- user, session, provider, or OAuth client identifiers;
- request or deployment context;
- callback inputs or outputs;
- error names, messages, stacks, fields, or serialized forms;
- timing or retry metadata.

Redacting, hashing, truncating, or allowlisting a raw cause is not an approved alternative. The safe value is the compile-time stage label, not a transformed upstream value.

## Relationship to `RFC-nostics`

`internal/RFC-nostics.md` evaluates a build-only catalog for user-actionable Nuxt installation and configuration failures. It explicitly excludes runtime files, auth-proxy errors, runtime events, and causes.

This RFC preserves that boundary:

- no `nostics` import enters `src/runtime/**`;
- no `Diagnostic` object is constructed;
- no catalog, registry, reporter plugin, or documentation-per-code system is added;
- no existing semantic logger or DevTools path changes;
- the five labels remain local constants in one auth factory owner.

If implementation needs a reusable runtime diagnostic abstraction, this RFC fails.

## Operator documentation

The existing operations troubleshooting page may contain one table for the five labels. It must explain only the safe operator action for the stage, such as validating deployment configuration or reproducing initialization locally.

The documentation must not suggest that a stage label proves a specific upstream root cause. It must not ask users to print raw auth errors, secrets, provider objects, or environment values.

Renaming or removing an operator label requires a release note. The labels are support terms, not application branching contracts, so no compatibility alias is required.

## Required proof matrix

| Scenario                                     | Required result                                                  |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Invalid `SITE_URL`                           | One site-origin label, then the existing generic failure         |
| Invalid `CONVEX_SITE_URL`                    | One Convex-origin label, then the existing generic failure       |
| Invalid versioned secrets                    | One secrets label, then the existing generic failure             |
| OAuth profile callback throws any value      | One OAuth-profile label, then the existing generic failure       |
| Social or feature plugin construction fails  | One composition label, then the existing generic failure         |
| Better Auth construction or `$context` fails | One composition label, then the existing generic failure         |
| Initialization succeeds                      | No initialization label                                          |
| `console.error` throws                       | The existing generic auth failure still wins                     |
| Normal auth HTTP failure                     | Existing body and status remain byte-for-byte compatible         |
| OAuth operator failure                       | Existing caller error remains unchanged and one label is emitted |

The sentinel suite must place unique private values in origins, secrets, callback errors, provider objects, thrown non-Error values, and upstream initialization failures. It must prove absence from:

- every console argument other than the expected fixed line;
- direct thrown-error inspection and serialization;
- HTTP bodies and headers;
- SSR, browser, DevTools, and public error surfaces;
- captured runtime output beyond the one fixed line.

The proof must also confirm:

- stage selection uses control flow, not caught-value inspection;
- no new export, option, route, table, environment variable, or dependency exists;
- no stage is reported twice through nested catches;
- packed-consumer, auth sentinel, and auth security suites remain green.

## Acceptance and rejection gates

Accept the RFC only when the complete proof uses one private reporter and the existing operator log. The public contract must remain unchanged.

Reject the RFC when:

- a stage needs dynamic metadata to be actionable;
- the implementation examines a caught value;
- the operator needs a callback, configuration option, or new log channel;
- a failure is reported more than once;
- a stage label crosses an HTTP or client boundary;
- more than the five stages are needed;
- the generic composition label cannot support an honest operator action.

If the composition label is not actionable, omit that label rather than subdividing upstream internals.

## Alternatives considered

### Keep only `AUTH_CONFIG_INVALID`

This remains the default if the proof fails. It is safe and already supported, but it requires more manual isolation during deployment failures.

### Attach a safe cause

Rejected. Unknown upstream values are not safe merely because a sanitizer processes them. Causes also risk crossing inspection, serialization, or HTTP boundaries.

### Add a diagnostic callback

Rejected. A callback becomes public API, creates another failure path, and invites applications to persist or transmit sensitive metadata.

### Use the semantic logger or DevTools

Rejected. Backend initialization can fail before those Nuxt runtime systems exist. They also serve runtime activity rather than deployment-operator failure.

### Use `nostics`

Rejected for this scope. Its evaluated role is build-only diagnostics. Importing it into the auth runtime would violate the existing proof boundary and add unnecessary serialization behavior.

### Parse provider messages

Rejected. Message matching is unstable and requires reading the exact raw value that the auth boundary is designed to hide.

## Decision

Pending proof and maintainer approval.
