# Private callable controller cutover — 2026-07-22

## Outcome

Mutation and action lifecycle now share one framework-neutral controller in
`src/runtime/client-core/callable-controller.ts`, backed by the private
`call-state.ts`. The old `src/runtime/utils/callable-lifecycle.ts` and
`src/runtime/utils/call-state.ts` sources were deleted with no compatibility
path.

The controller owns:

- latest-attempt reactive state;
- throwing and `.safe()` result equivalence;
- normalized errors and callback containment;
- identity-generation binding and stale-completion retirement;
- settlement-before-dispatch ordering;
- reset and idempotent disposal;
- generic lifecycle event hooks.

Nuxt mutation/action adapters retain auth settlement, stable-client dispatch,
optimistic-update configuration, logging, and DevTools projection. The private
controller has no Nuxt, Nitro, H3, Better Auth, runtime-context, logger, or
DevTools import.

## Correctness fix found during extraction

The previous lifecycle captured identity generation before awaiting
`ensureConvexAuthReady()`. When an invocation began during initial auth loading,
settlement could advance the generation before dispatch. The operation would
then execute through the newly settled identity but be rejected on completion
as if it had been dispatched under the old identity.

The controller now:

1. exposes pending state synchronously;
2. awaits the adapter's settlement function;
3. restores pending only for the latest live attempt if settlement caused the
   identity transition to mask provisional state;
4. captures identity generation immediately after settlement;
5. invokes the operation;
6. rejects completion if generation changes after dispatch.

Reset increments the attempt revision, so it cannot be undone by a later
settlement. Disposal retires pending state and callbacks exactly once and
rejects later retained-function calls with a static `CALL_DISPOSED` error.

## Executed proof

The pure call-state/controller and Nuxt mutation/action matrix passed 4 files /
30 tests. It proves:

- no dispatch before settlement;
- successful binding to the identity produced by settlement;
- mid-flight identity switch rejection with no callbacks or visible stale state;
- owner-produced identity rejection passthrough;
- settlement failure normalization with no dispatch;
- latest-call state ownership;
- reset during settlement remains final;
- disposal retires late completion and is idempotent;
- throwing and `.safe()` paths return equivalent normalized errors;
- callback failures cannot rewrite successful or failed operation outcomes.

The private source-island boundary passed across 243 source files. The complete
repository check passed formatting, lint, all typechecks and architecture
rules, plus 160 test files / 1,818 tests.

## Public API admission

No public controller, state, auth adapter, event type, or error kind was added.
The controller remains private until the Phase 4 two-consumer and exact-artifact
admission gates pass.
