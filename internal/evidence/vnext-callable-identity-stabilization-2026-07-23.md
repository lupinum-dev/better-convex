# vNext callable identity stabilization — 2026-07-23

## Authority

- BCN base: `81f6c8071b47731a3fc2ad046f0f2992e5ed165b`
- BCN fix: `22927195`
- Ginko base: `7babc91570cd9e3c458a149e485a0c75e8cd2020`
- Ginko fix: `260653d7`

## Invariant

A mutation or action is bound to the identity generation present when the application invokes it. If
authentication settlement or application work crosses an identity-generation boundary, the operation
must fail with `IDENTITY_CHANGED` before the underlying client dispatch. A result dispatched under the
original generation must not update state after that generation is retired.

## Change

- The shared Vue callable controller captures generation before settlement and rechecks it immediately
  before dispatch.
- Mutation and action tests now reject a settlement-time generation change and assert zero dispatch.
- A synchronous pre-dispatch callback changing generation is also rejected.
- Ginko no longer wraps the stable client with a blanket asynchronous contract-status query. Canonical
  backend operation guards remain authoritative, and upload-session rejection still occurs before file
  bytes are sent.

## Executed proof

```text
pnpm exec vitest run --project=unit test/unit/callable-lifecycle.test.ts
  1 file, 16 tests passed

pnpm exec vitest run --project=unit \
  test/unit/callable-lifecycle.test.ts test/unit/client-owner.test.ts
  2 files, 42 tests passed

pnpm --dir packages/vue typecheck
  passed

./node_modules/.bin/vitest run test/runtime/studio-contract-write-gate.test.ts
  1 file, 2 tests passed
```

The focused Ginko test used a temporary untracked link to the locally built Vue package because Ginko's
declared unpublished beta.4 tarball cannot be fetched. The link was removed immediately after the test.
This proves the source integration behavior only; it is explicitly not exact-candidate evidence.
Exact-tarball Ginko proof remains `S6-004`.

## Closure

The original unsafe test expected a call started before settlement to dispatch under the later identity.
That expectation has been replaced by mutation and action regressions asserting `IDENTITY_CHANGED` and
zero invocation. Mid-flight completion fencing and legitimate same-generation settlement remain covered.
