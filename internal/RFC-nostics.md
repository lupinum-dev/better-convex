# RFC: Narrow `nostics` Adoption for Build and Configuration Diagnostics

- Status: Proposed proof; no dependency approved yet
- Date: 2026-07-15
- Target: Post-1.0 supportability improvement; not a release prerequisite

## Summary

Evaluate `nostics` as the implementation behind a small catalog of permanent, developer-facing Better Convex Nuxt build and configuration diagnostics.

The proposed scope is deliberately narrow:

- Nuxt module setup failures;
- invalid Better Convex Nuxt configuration;
- actionable build-time warnings;
- stable diagnostic codes with matching documentation pages.

`nostics` will not replace:

- `ConvexCallError`;
- Convex application error codes;
- auth-proxy HTTP error shapes;
- the runtime semantic logger;
- Nuxt DevTools events;
- application telemetry;
- ordinary internal invariant errors.

The dependency is adopted only if a proof demonstrates enough real diagnostics to justify a permanent catalog, keeps all `nostics` imports outside `src/runtime/**`, preserves Better Convex Nuxt's redaction guarantees, and improves packed-consumer output without introducing duplicate reporting.

## Decision requested

Approve a time-boxed proof, not a production-wide migration.

The proof answers one question:

> Does a stable, documented diagnostic catalog materially improve the errors users receive while installing and configuring Better Convex Nuxt, without creating a second runtime error or logging system?

If the answer is no, the proof is deleted and the repository retains native errors plus improved messages.

## Context

Better Convex Nuxt already has three intentionally different failure and observability systems.

### Operation failures

`ConvexCallError` is the framework-free public contract for failed queries, mutations, actions, uploads, server calls, authentication, and transport boundaries. It classifies errors, preserves structured Convex application data, and excludes runtime-only causes from serialization and logs.

### Security and HTTP contracts

The auth proxy returns stable `BCN_AUTH_PROXY_*` codes in bounded HTTP error shapes. These codes are machine-readable security and protocol contracts.

### Runtime events

The semantic logger and DevTools sink record auth phases, query subscriptions, mutations, actions, uploads, connection changes, and timing. These are operational events rather than user-actionable configuration diagnostics.

None of those systems consistently answers:

- What did the library user configure incorrectly?
- What exact action fixes it?
- What stable term can the user search for?
- Which documentation page remains valid after the message wording changes?

`nostics` may fill that gap.

## Motivation

Current actionable module and configuration failures include cases such as:

- an explicit `auth.client` path cannot be resolved;
- authentication is enabled without a usable `siteUrl`;
- a deployment or site URL contains credentials, a query, a fragment, or a non-root path;
- a non-loopback HTTP URL is configured;
- `auth.trustedClientIpHeader` is not a valid header name;
- generated Convex API files are absent when application code accesses `#convex/api`.

The current messages are generally specific, but they are anonymous strings. Users cannot rely on a stable identifier, and documentation cannot link every failure to a permanent troubleshooting page.

A diagnostic catalog could provide:

- stable semantic codes;
- typed message parameters;
- a concise explanation and exact fix;
- a permanent documentation URL;
- consistent terminal formatting;
- a CI-enforced code-to-documentation relationship;
- better search and coding-agent support.

## Why this is not a general migration

The repository already has strong error and logging foundations. Replacing them would create parallel concepts and weaken established invariants.

The desired relationship is:

| Concern                               | Owner                                                          |
| ------------------------------------- | -------------------------------------------------------------- |
| Nuxt module/configuration misuse      | Narrow `nostics` catalog under evaluation                      |
| Failed Convex operation               | `ConvexCallError`                                              |
| Backend domain rejection              | Application-owned `ConvexError.data.code`                      |
| Auth-proxy protocol/security response | Existing `BCN_AUTH_PROXY_*` HTTP shape                         |
| Query/auth/mutation/upload activity   | Existing semantic logger and DevTools                          |
| Internal impossible state             | Native internal error, normally without public diagnostic docs |

One event must not be represented in two of these systems merely for convenience.

## Goals

1. Give actionable build and configuration failures stable identifiers.
2. Put the corrective action next to the failure.
3. Link each published code to a permanent documentation page.
4. Type-check diagnostic interpolation parameters at their call sites.
5. Preserve the Nuxt logger for warnings and Nuxt's normal handling for thrown setup failures.
6. Prevent duplicate console output.
7. Keep diagnostic values credential-safe and bounded.
8. Keep `nostics` out of browser, server runtime, and public error entry points.
9. Verify the installed package rather than only source imports.
10. Make removal of an unsuccessful experiment direct and complete.

## Non-goals

This RFC does not propose:

- replacing or subclassing `ConvexCallError` with `Diagnostic`;
- converting `ConvexError` payloads into library diagnostics;
- changing auth-proxy response shapes;
- assigning diagnostic codes to normal runtime events;
- forwarding diagnostics to files, HTTP endpoints, or external monitoring;
- installing the nostics Vite development collector;
- installing `@nostics/unplugin`;
- stripping build/configuration messages from production builds;
- exposing the catalog as application API;
- generating application-domain diagnostic codes;
- documenting every internal assertion as a public support contract;
- preserving two diagnostic implementations if the proof is rejected.

## Dependency assessment

At the time of this RFC, the evaluated package is `nostics@1.1.4`.

Positive properties:

- ESM-only, matching the package's toolchain;
- no core runtime dependencies;
- typed code parameters;
- `Diagnostic` extends `Error`;
- plain, ANSI, and JSON formatters;
- substantial unit and type coverage;
- side-effect-free package metadata;
- support for retaining code and docs links without full production catalog text.

Risks:

- the package is new and its long-term API stability is not yet established;
- `Diagnostic.toJSON()` includes `cause`, `stack`, and `sources`;
- reporters run when the diagnostic handle is called, including before a returned diagnostic is thrown;
- production-stripping advice is not appropriate for build-time failures that must remain understandable during production builds;
- adding a dependency creates a permanent compatibility and release obligation.

The proof must pin the evaluated version exactly. A production adoption decision must separately choose and document the supported version range.

## Security boundary

The default nostics serialization policy is incompatible with Better Convex Nuxt's public runtime error policy.

`ConvexCallError` deliberately:

- keeps `cause` runtime-only;
- omits `cause` from `toJSON()`;
- excludes `cause` from payloads;
- uses custom Node inspection to prevent cause-only secrets from appearing in logs.

`Diagnostic.toJSON()` includes `cause`, `stack`, and `sources`. Therefore the proof adopts these hard rules:

1. No `nostics` import may exist under `src/runtime/**`.
2. No nostics `Diagnostic` may cross an SSR payload, HTTP response, DevTools bridge, or public call-result envelope.
3. Diagnostic definitions and calls do not accept or forward `cause` during the proof.
4. Diagnostic calls do not use `sources` during the proof.
5. No code calls `Diagnostic.toJSON()`.
6. No file, fetch, browser-dev, or custom telemetry reporter is configured.
7. Diagnostic parameters are limited to values already considered safe for user-visible build output.
8. Tests include credential sentinels and prove they do not appear in formatted diagnostics or packed output.

If a useful diagnostic requires an unrestricted upstream cause, it remains a native error or receives a separately sanitized, explicit parameter. The original object is not passed through the catalog.

## Proposed scope

The proof creates one build-only catalog:

```text
src/module-diagnostics.ts
```

This file may be imported by `src/module.ts` and other build-only module helpers. It must not be imported by runtime templates or files under `src/runtime/**`.

Candidate codes:

```text
BCN_CONFIG_AUTH_CLIENT_NOT_FOUND
BCN_CONFIG_SITE_URL_MISSING
BCN_CONFIG_DEPLOYMENT_URL_INVALID
BCN_CONFIG_SITE_URL_INVALID
BCN_CONFIG_TRUSTED_IP_HEADER_INVALID
```

The proof begins with an inventory rather than assuming every candidate deserves a permanent code. A code qualifies only when:

- the user can take a specific corrective action;
- the failure is caused by application installation or configuration;
- the condition is stable enough to document permanently;
- a stable code improves support beyond the existing message;
- the diagnostic can be produced without exposing sensitive data.

The missing generated API proxy is not automatically included. It executes through a generated application-facing runtime template, so integrating nostics there would violate the build-only boundary. It may retain its current native error and receive a manually stable code only if that does not introduce another catalog.

## Code naming policy

Use descriptive semantic codes rather than numeric allocation:

```text
BCN_<AREA>_<CONDITION>
```

Examples:

```text
BCN_CONFIG_SITE_URL_MISSING
BCN_CONFIG_AUTH_CLIENT_NOT_FOUND
```

Reasons:

- the current public HTTP codes already use descriptive names;
- a semantic code is understandable without consulting a registry;
- the expected catalog is small;
- numeric allocation would add bookkeeping without improving uniqueness.

Published codes are permanent:

- message and fix wording may improve;
- a code may not be reused for a different condition;
- retired documentation URLs continue to resolve and explain the retirement;
- code removal is reviewed as a user-visible compatibility change.

## Proposed catalog

Illustrative implementation:

```ts
import { defineDiagnostics } from 'nostics'

export const moduleDiagnostics = defineDiagnostics({
  docsBase: (code) => `https://better-convex-nuxt.dev/errors/${String(code).toLowerCase()}`,
  codes: {
    BCN_CONFIG_AUTH_CLIENT_NOT_FOUND: {
      why: (params: { specifier: string }) =>
        `The auth.client module "${params.specifier}" could not be resolved.`,
      fix: (params: { resolvedPath: string }) =>
        `Create the definition at "${params.resolvedPath}" or update auth.client.`,
    },
    BCN_CONFIG_SITE_URL_MISSING: {
      why: 'Authentication is enabled but no usable siteUrl was resolved.',
      fix: (params: { hint: string }) => params.hint,
    },
  },
})
```

This example is not approved implementation. In particular, path and hint parameters must pass the repository's diagnostic-safety review before use.

## Reporting model

The catalog has no global reporters:

```ts
export const moduleDiagnostics = defineDiagnostics({
  docsBase,
  codes,
})
```

This avoids a thrown diagnostic being printed once by a reporter and again by Nuxt.

### Thrown setup failures

Return a `Diagnostic` and let Nuxt surface the thrown error once:

```ts
throw moduleDiagnostics.BCN_CONFIG_AUTH_CLIENT_NOT_FOUND({
  specifier,
  resolvedPath,
})
```

### Non-fatal warnings

Format explicitly and send through Nuxt's existing module logger:

```ts
const diagnostic = moduleDiagnostics.BCN_CONFIG_SITE_URL_MISSING({ hint })
logger.warn(formatDiagnostic(diagnostic))
```

There is no implicit report-on-construction behavior because no reporters are configured.

The proof must verify actual Nuxt terminal output and confirm that each warning or failure appears exactly once.

## Production behavior

Build and configuration diagnostics must retain their full explanation during production builds. A production build is a primary place where configuration errors occur.

Therefore the proof does not use:

- `defineProdDiagnostics`;
- environment-selected lean catalogs;
- `nosticsStrip`;
- `@nostics/unplugin`;
- automatic removal of report-only calls.

Because the catalog is build-only, it must not enter application client or Nitro runtime chunks. Bundle exclusion, rather than message stripping, is the required production property.

## Relationship to existing codes

### `ConvexCallError.code`

No change. It continues to represent stable library classifications such as `IDENTITY_CHANGED` and application-owned structured error codes.

### `BCN_AUTH_PROXY_*`

No change to HTTP behavior or types. These codes may receive troubleshooting pages in the same documentation area, but they do not become nostics handles during this proof.

Sharing documentation URL conventions does not make the runtime objects share an implementation.

### Native internal errors

Internal assertions such as disposed owners, impossible runtime attachment, invalid base64url input, and unexpected internal chunks do not automatically become public diagnostics. A permanent code is warranted only when a library user can reasonably fix the condition.

## Documentation registry

Every accepted catalog code receives a page at:

```text
/docs/errors/<lowercase-code>
```

Each page uses the same structure:

1. code and severity;
2. what happened;
3. how to fix it;
4. common causes;
5. a minimal corrected example;
6. affected versions or migration notes when relevant.

The corrective action appears near the top. Pages render useful initial HTML and preserve their URL after a code is retired.

The catalog remains the source of truth for the current code set. A unit or docs-contract test imports the catalog, enumerates its keys, and verifies that each key has a matching documentation page. The test must not introduce a separately maintained manifest of the same codes.

The inverse is also checked: an active diagnostic page must correspond to a current code or explicitly declare itself retired.

## Architecture boundaries

The proof adds mechanical checks for these boundaries:

```text
src/module-diagnostics.ts  -> may import nostics
src/module.ts              -> may import module-diagnostics
src/runtime/**             -> must not import nostics or module-diagnostics
src/runtime/errors/**      -> remains nostics-free
src/runtime/server/**      -> remains nostics-free
```

The package's public `/errors` subpath remains framework-free and does not export nostics types.

The main module entry does not re-export the diagnostic catalog. Catalog handles are implementation details even though their emitted codes and documentation URLs are public support contracts.

## Alternatives considered

### Keep native errors and improve their messages

This is the default if the catalog remains small. It adds no dependency and preserves current behavior.

Decision: still viable. Prefer this option if the proof finds fewer than approximately six strong, actionable diagnostics or cannot keep nostics build-only.

### Implement a local diagnostic framework

A local `Diagnostic` class and typed catalog could satisfy the immediate use case, but it duplicates a maintained package and creates another subsystem for this repository to own.

Decision: rejected unless the complete required local implementation is demonstrably smaller and safer than the dependency. Do not recreate reporters, formatters, registries, or plugins.

### Use stable codes without nostics

Native errors can include a stable code and docs link in their message.

Decision: a credible fallback for a very small catalog. It loses typed catalog parameters and standardized formatting but may be the simplest correct design.

### Replace `ConvexCallError`

Nostics diagnostics serialize causes and do not provide Better Convex Nuxt's operation-kind, payload revival, or redaction contract.

Decision: rejected.

### Route runtime logs through nostics reporters

Operational events are not diagnostics and already have semantic logging and DevTools paths.

Decision: rejected.

### Install the dev collector

The collector would introduce another browser-to-Vite diagnostics channel alongside Nuxt DevTools and would require separate redaction, cleanup, and HMR guarantees.

Decision: rejected.

### Use file or fetch reporters

Library-owned telemetry would surprise consumers and could expose diagnostic values, paths, causes, or stacks.

Decision: rejected. Monitoring remains application-owned.

## Proof plan

### Phase 0: inventory

List every user-actionable build/configuration warning and failure. For each candidate, record:

- current call site;
- current message;
- user action;
- whether values may contain credentials or absolute paths;
- whether it executes only during Nuxt module setup;
- whether a permanent docs page provides meaningful value.

Reject internal invariants and generic upstream failures from the catalog.

Exit criterion: at least six diagnostics satisfy the qualification rules, or there is a documented reason a smaller set still justifies the dependency.

### Phase 1: isolated spike

Add the exact-pinned dependency, one build-only catalog, and two representative diagnostics:

- one thrown configuration failure;
- one non-fatal Nuxt module warning.

Do not migrate all candidate sites yet.

Exit criteria:

- output appears once;
- codes, fixes, and URLs are readable;
- no credential sentinel appears;
- no runtime bundle contains nostics or catalog text;
- packed Nuxt consumer setup behaves correctly;
- no existing public error contract changes.

### Phase 2: adoption decision

If the spike passes, migrate only the approved inventory and add documentation pages. If it fails, delete the catalog and dependency in the same change; do not leave an adapter or compatibility path.

### Phase 3: stabilization

After one experimental release, evaluate support reports and user feedback. Stabilization means committing to code and URL longevity, not exporting catalog internals.

## Testing strategy

### Unit tests

- each handle requires its typed parameters;
- every diagnostic has the expected stable name, message, fix, and URL;
- throwing a handle produces an `Error` compatible with Nuxt setup failure handling;
- no reporter runs implicitly;
- warning formatting is deterministic;
- credential sentinels are absent;
- no cause or source is included;
- catalog keys match active documentation pages.

### Nuxt module tests

- unresolved `auth.client` fails setup once with the code and fix;
- missing `siteUrl` warns once through the Nuxt logger;
- valid configuration emits neither diagnostic;
- production build retains the full actionable message;
- expected exit codes and Nuxt error behavior remain unchanged.

### Architecture tests

- `src/runtime/**` contains no import from `nostics` or `module-diagnostics`;
- `/errors` declarations and packed probes contain no nostics type;
- client and Nitro runtime chunks contain no nostics catalog text;
- only the Nuxt module/build entry retains the dependency;
- the package does not depend on `@nostics/unplugin`.

### Packed consumer tests

- a packed installation resolves the nostics dependency correctly;
- a clean Nuxt consumer receives the expected diagnostic during module setup;
- a valid production build contains no nostics client/runtime code;
- package export and undeclared-dependency checks remain green.

## Documentation requirements

If adopted, add:

- a diagnostics index organized by configuration area;
- one permanent page per code;
- links from relevant configuration guides;
- a short explanation distinguishing diagnostics from `ConvexCallError`;
- guidance for copying a diagnostic code into issues and support requests;
- a contribution rule requiring a docs page with every new published code.

Do not present file, fetch, or telemetry reporters as supported Better Convex Nuxt integration paths.

## Acceptance criteria

The RFC is accepted for production implementation only if the proof demonstrates all of the following:

1. The inventory contains enough real, actionable diagnostics to justify a dependency.
2. `nostics` is imported only by build/module code.
3. `ConvexCallError`, auth-proxy errors, runtime logger, and DevTools remain unchanged in ownership.
4. No diagnostic cause, source, stack, credential, cookie, header, or upstream response is serialized or forwarded.
5. Warnings and thrown failures appear exactly once.
6. Full build-time messages remain available in production builds.
7. No `@nostics/unplugin`, dev collector, file reporter, or fetch reporter is installed.
8. Every published code has a permanent docs page enforced from the catalog's code set.
9. Client and Nitro runtime artifacts contain no nostics code or catalog text.
10. Packed-consumer, type, lint, test, boundary, security, and documentation checks pass.
11. The implementation is simpler than maintaining equivalent local catalog machinery.
12. Rejection of the proof results in complete deletion, with no adapter or dual path left behind.

## Rejection criteria

Reject adoption if any of these is true:

- fewer than approximately six diagnostics justify permanent public support contracts;
- the dependency enters runtime bundles;
- useful diagnostics require unrestricted `cause` or `sources` serialization;
- Nuxt output is duplicated;
- the docs registry creates a second manually maintained code manifest;
- production builds lose actionable messages;
- the package requires `@nostics/unplugin` for acceptable output;
- existing error or logger contracts must be weakened to accommodate it;
- native errors with stable codes would be materially simpler.

## Open questions

1. Is the actionable inventory large enough to justify the dependency now?
2. Should permanent diagnostic pages use `/errors/` or `/diagnostics/`?
3. Should retired codes remain in the catalog as non-emitting metadata, or only retain their documentation pages?
4. Can absolute resolved paths be displayed safely, or should diagnostics show only the user-provided specifier and a root-relative path?
5. Should the production dependency remain exactly pinned until nostics has a longer stability history?
6. Should existing `BCN_AUTH_PROXY_*` codes share the same docs index while remaining independent runtime contracts?

These questions must be answered by the proof and inventory. They are not permission to widen nostics into runtime errors, telemetry, or application diagnostics.
