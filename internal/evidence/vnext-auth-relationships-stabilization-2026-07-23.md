# vNext Better Auth relationship stabilization evidence — 2026-07-23

## Scope and decision

This closes post-audit finding `PA-001` and stabilization tasks `S3-001`–`S3-003`.

The exact pinned Better Auth `1.7.0-rc.1` database contract defines reference deletion as
`cascade | restrict | set null | set default | no action` and documents omitted `onDelete` as
`cascade`. Its core user/session and user/account relationships explicitly use cascade. Better Convex
now materializes that contract in generated metadata instead of retaining decorative reference data.

Convex execution supports exactly:

- `cascade`;
- `restrict`;
- `set null` on nullable fields.

Schema generation fails closed for `set default`, deferred `no action`, required-field set-null,
unknown targets, and unindexed targets. No approximation, background cascade, compatibility path, or
second relationship registry was added.

## Runtime invariants

- Create and reference-changing update require exactly one indexed parent.
- A delete computes its cascade closure with a visited set.
- Restrict is evaluated before writes and aborts the whole Convex transaction.
- Set-null updates run before child-before-parent deletion.
- Relationship-driven updates and deletes invoke the existing application trigger functions.
- `deleteOne`, `deleteMany`, and one-time `consumeOne` use the same atomic deletion planner.
- Large closures remain bounded by Convex transaction/read limits and fail atomically.

## Executed proof

```text
pnpm exec jiti scripts/generate-auth-schema.mjs --check
  passed

pnpm exec vitest run \
  test/unit/convex-auth-adapter-invariants.test.ts \
  test/convex/auth-adapter-relationships.test.ts \
  --config vitest.config.ts
  3 project files, 46 tests passed

pnpm test:auth-adapter
  2 files, 33 tests passed

pnpm check:better-auth-local-component
pnpm check:better-auth-two-factor
pnpm typecheck:module
  passed

focused ESLint and git diff --check
  passed
```

The component-runtime matrix proves:

- missing-parent create and reference-changing update reject without modifying the row;
- user deletion cascades session and account rows;
- session deletion sets the nullable delegated-token session reference to null;
- a surviving restrict child rolls back the parent delete, a cascade sibling, and a pending set-null
  sibling;
- successful mixed cascade/set-null deletion invokes child delete, parent delete, and child update
  triggers;
- delete then recreate is valid after the complete closure is removed;
- a cyclic cascade closure terminates and deletes each row exactly once.

The full `check:auth-schema` packed/local-backend ceremony was attempted separately. Its first attempt
failed before packing because the machine's default npm cache contains root-owned files. A retry with an
isolated temporary npm cache reached the silent local-backend phase but was intentionally stopped after
the bounded interactive wait. The canonical generator, component runtime, fixture typechecks, and
focused adapter suite above are the completion proof for this change; the full packed/live ceremony
remains part of `S6-003`.

## Exact upstream evidence

The enforcing pinned sources inspected for this decision are:

- `@better-auth/core/src/db/type.ts`: the five declared policies and default cascade;
- `@better-auth/core/src/db/get-tables.ts`: explicit cascade on core session/user and account/user
  references;
- the generated OAuth-provider schema consumed by `scripts/generate-auth-schema.mjs`: physical model
  and field mappings for OAuth client, resource, consent, access-token, refresh-token, and session
  relationships.
