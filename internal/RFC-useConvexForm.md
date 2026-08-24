# RFC: `useConvexForm` submission boundary

- Status: Accepted
- Target: Better Convex 1.0
- Decision: external values, required Standard Schema, one mutation

## Problem

Consumer forms repeatedly combine client validation, mutation argument transformations, contextual arguments, duplicate-submit guards, and safe field/form error routing. `useConvexMutation` correctly owns transport and identity, while broad form libraries correctly own editable values and interaction state. The missing boundary is the small connection between them.

## Accepted contract

`useConvexForm(mutation, options)` owns exactly one `useConvexMutation` instance. `options.schema` is mandatory and implements Standard Schema. The optional `toArgs` maps validated schema output into mutation arguments. Arguments not produced by that mapping become the typed second argument to `submit(values, contextualArgs)`.

The controller returns readonly `data`, `status`, `pending`, `error`, `issues`, `fieldErrors`, and `formError`, plus `submit()` and `reset()`.

Submission returns a discriminated result:

```ts
type ConvexFormSubmitResult<Result> =
  | { readonly ok: true; readonly data: Result }
  | { readonly ok: false; readonly error: ConvexFormError }
```

Expected validation and normalized mutation failures resolve as `ok: false`. Unexpected validator, transformer, or implementation bugs reject. Consumers perform success work explicitly after checking `result.ok`.

## Ownership

- The component or its chosen form library owns values, initial values, dirty/touched state, fields, focus, navigation, and messages.
- Standard Schema owns browser validation and transformations.
- `useConvexMutation` remains the only mutation transport, identity fence, error normalizer, and DevTools operation source.
- Convex validators, authorization, and application functions remain authoritative.

No form values are retained, reset, or persisted by Better Convex.

## Validation and errors

Validation operates on a synchronous snapshot of submitted external values and supports synchronous or asynchronous validators. Known top-level paths become field errors. Nested paths retain their complete normalized path and route to their known top-level field. Pathless and unknown paths remain form-level errors.

`mapError(ConvexCallError)` may map a normalized mutation failure to a form message and known submitted fields. The original safe `ConvexCallError` remains available on `ConvexFormError`; raw causes are never retained. Unknown runtime field names fall back to the form level instead of disappearing.

## Concurrency and retirement

The first call synchronously claims the submission guard and snapshots values. A duplicate call returns the exact active Promise; it cannot issue a second mutation. There is no concurrency option.

`reset()` clears presentation state but cannot cancel or roll back a mutation. While work remains active, `pending` stays true and duplicates still share the active Promise. Reset, identity replacement, or scope disposal retires state ownership so an older completion cannot repopulate the controller.

## Rejected surface

The 1.0 API does not include values, initial values, touched/dirty state, field registration, field arrays, validation methods, callbacks, automatic success reset, navigation, toasts, uploads, autosave, optimistic form orchestration, multiple mutations, schema-less operation, validator adapters, keyed registries, or compatibility exports.

Use `useConvexMutation` for commands, concurrency, optimistic writes, uploads, autosave, and multi-mutation workflows. Use a dedicated form library for broader interaction state.

## Admission evidence

Stable admission requires:

1. type proof for schema input/output transformations and contextual mutation arguments;
2. runtime proof for validation, safe errors, duplicates, reset, identity retirement, and disposal;
3. one ordinary Nuxt DevTools mutation event per submission;
4. packed consumers using ArkType, Zod, and an asynchronous Standard Schema validator;
5. Luis proof across genuine single-mutation forms;
6. Ginko proof without changing its dynamic editor, autosave, uploads, or auth flows.

If those proofs require value ownership, adapters, casts in consumer code, or a second lifecycle, remove the controller instead of widening it.
