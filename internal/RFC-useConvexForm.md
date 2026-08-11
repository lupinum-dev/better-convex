# RFC: `useConvexForm`

- Status: Proposed
- Date: 2026-07-15
- Target: Post-core experimental release; not a Better Convex Nuxt 1.0 prerequisite

## Summary

Add a small, Vue-native `useConvexForm` composable that connects Standard Schema validation to a typed Convex mutation and Better Convex Nuxt's existing `ConvexCallError` lifecycle.

The composable owns only the repeated integration work at that boundary:

- typed form values and explicit initial values;
- client-side validation through Standard Schema;
- mutation-argument type compatibility;
- duplicate-submit protection and pending state;
- safe routing of structured server errors to known fields or the form;
- reset and success behavior.

It does not attempt to become a general-purpose Vue form framework. Backend validators and authorization remain canonical. Client validation exists for immediate user feedback, not security.

## Motivation

Better Convex Nuxt already provides a strong mutation primitive:

- direct Promise-returning execution;
- normalized `ConvexCallError` failures;
- preserved structured `ConvexError.data`;
- reactive status, pending, data, and error state;
- identity-generation protection;
- readonly lifecycle state.

Applications still repeatedly write the layer between that primitive and a form:

1. hold and reset field values;
2. run a client schema;
3. convert schema issues into field errors;
4. prevent duplicate submissions;
5. interpret `ConvexCallError.data`;
6. verify that a server-named field exists before displaying its error;
7. combine form values with non-form mutation arguments.

That repetition creates correctness problems rather than merely verbosity. Error payloads can be dropped, unknown server fields can silently disappear, client schemas can drift from mutation argument types, and concurrent submissions can produce misleading pending state.

`useConvexForm` should remove this repeated integration code while continuing to delegate mutation execution and identity safety to `useConvexMutation`.

## Goals

1. Accept validators implementing Standard Schema without requiring Zod, Valibot, ArkType, or another schema library as a runtime dependency.
2. Infer form value types from the schema.
3. Reject form and submission argument combinations that cannot call the selected mutation.
4. Preserve Better Convex Nuxt's single normalized error contract.
5. Route a structured server error to a field only when that field is known to the form.
6. Prevent accidental concurrent submissions by default.
7. Restore explicit initial values deterministically.
8. Remain client-only and identity-safe through the existing mutation lifecycle.
9. Keep the first public surface small enough to test and support as a long-lived API.

## Non-goals

The first version will not provide:

- form components or rendered controls;
- Zod-specific schema introspection;
- automatic initial values inferred from a schema;
- backend validation or authorization;
- a generated end-to-end type for every error a Convex function may throw;
- nested collection helpers, field arrays, or wizard state;
- touched, visited, dirty, or focus-management state;
- autosave, debouncing, or optimistic form submission;
- a persistent per-row form registry such as `.for(id)`;
- adapters for other Vue form libraries;
- server-rendered form submission or Nuxt server actions;
- automatic localization of backend error messages.

These capabilities may be reconsidered only after concrete application demand. They are not reserved extension points in the first implementation.

## Design principles

### One mutation lifecycle

`useConvexForm` must call `useConvexMutation`; it must not implement a second Convex mutation transport, authentication path, error normalizer, or identity lifecycle.

### Explicit initial state

Standard Schema validates values but does not portably describe how to construct them. Initial values are therefore required. Reset returns to a fresh copy produced from those values.

### Backend remains authoritative

The browser schema improves feedback and can prevent obviously invalid calls. It never replaces Convex argument validators, application validation, authorization, or database invariants.

### Unknown errors remain visible

An error naming an unknown field must become a form-level error. It must never be discarded.

### No speculative state registry

List-row forms should initially use ordinary Vue component scopes. The library will not retain keyed form instances whose cleanup and identity semantics it cannot make obvious.

## Proposed API

```ts
const invite = useConvexForm(api.members.invite, {
  schema: z.object({
    email: z.string().email('Enter a valid email'),
    role: z.enum(['admin', 'member']),
  }),

  initialValues: {
    email: '',
    role: 'member',
  },

  mapServerError(error) {
    if (error.code === 'ALREADY_MEMBER') {
      return { form: 'This person is already in the workspace.' }
    }
  },
})
```

```vue
<script setup lang="ts">
import { z } from 'zod'
import { api } from '#convex/api'

const invite = useConvexForm(api.members.invite, {
  schema: z.object({
    email: z.string().email('Enter a valid email'),
    role: z.enum(['admin', 'member']),
  }),
  initialValues: {
    email: '',
    role: 'member',
  },
  mapServerError(error) {
    if (error.code === 'ALREADY_MEMBER') {
      return { form: 'This person is already in the workspace.' }
    }
  },
})
</script>

<template>
  <form @submit.prevent="invite.submit()">
    <input
      v-model="invite.values.email"
      name="email"
      type="email"
      :aria-invalid="invite.hasError('email')"
    />
    <p v-for="message in invite.errors.email" :key="message">
      {{ message }}
    </p>

    <select v-model="invite.values.role" name="role" :aria-invalid="invite.hasError('role')">
      <option value="member">Member</option>
      <option value="admin">Admin</option>
    </select>
    <p v-for="message in invite.errors.role" :key="message">
      {{ message }}
    </p>

    <p v-if="invite.error">{{ invite.error.message }}</p>

    <button :disabled="invite.pending">
      {{ invite.pending ? 'Inviting…' : 'Invite' }}
    </button>
  </form>
</template>
```

The intended return surface is:

```ts
interface UseConvexFormReturn<Values, ExtraArgs, Result> {
  values: Values
  errors: Readonly<Record<keyof Values, readonly string[]>>
  error: Readonly<Ref<ConvexFormError | null>>
  pending: Readonly<Ref<boolean>>
  status: Readonly<Ref<'idle' | 'invalid' | 'pending' | 'success' | 'error'>>

  validate(): Promise<FormValidationResult<Values>>
  submit(...args: SubmitArgs<ExtraArgs>): Promise<CallResult<Result, ConvexFormError>>
  reset(): void
  hasError<Field extends keyof Values>(field: Field): boolean
  setFieldError<Field extends keyof Values>(field: Field, message: string): void
  clearErrors(): void
}
```

This is an illustrative contract. The implementation spike may adjust Vue ref wrapping to provide correct template ergonomics, but it must not expand the responsibilities listed above.

## Values and initial values

`initialValues` is mandatory in the first version:

```ts
initialValues: Values | (() => Values)
```

A factory is preferred when values contain mutable arrays or objects. The implementation must clone or recreate initial state so that `reset()` cannot reuse a previously mutated object.

The initial values must be accepted by the schema input type. Successfully parsed schema output is used for mutation submission.

Schema defaults and transformations are allowed. Therefore the implementation must distinguish:

- schema input, used by editable `values`;
- schema output, used to construct mutation arguments.

## Mutation argument typing

Forms commonly own only part of a mutation's arguments. For example, `email` and `role` are editable while `organizationId` comes from the current route:

```ts
const invite = useConvexForm(api.members.invite, {
  schema,
  initialValues,
})

await invite.submit({ organizationId })
```

The type contract must ensure that the parsed schema output plus the arguments supplied to `submit()` can call `FunctionArgs<typeof api.members.invite>`.

Expected behavior:

- if schema output covers every required mutation argument, `submit()` takes no argument;
- if required mutation arguments remain, `submit()` requires exactly those remaining arguments;
- overlapping extra arguments are rejected rather than silently overriding parsed form values;
- incompatible schema output fails a type test;
- a newly required mutation argument causes an application type error until supplied by the schema or `submit()`.

The runtime merge order must not be configurable. Parsed form values and extra arguments must be disjoint by type and checked defensively in development.

## Validation lifecycle

`validate()` performs these steps:

1. clear previous client-validation errors;
2. validate a snapshot of current values through Standard Schema;
3. route issues whose first path segment is a known top-level form field to that field;
4. route pathless and unknown-path issues to the form-level error;
5. return a discriminated result containing either parsed output or issues.

The first version supports top-level field routing. It may preserve complete issue paths for debugging, but it will not expose a nested error-tree abstraction.

Validation must support both synchronous and asynchronous Standard Schema results.

## Submission and concurrency

`submit()` performs these steps:

1. synchronously claim the form's submission guard;
2. reject or ignore a duplicate call while the form is already submitting;
3. validate current values;
4. stop without calling Convex when validation fails;
5. combine parsed values with typed extra arguments;
6. execute the mutation through `useConvexMutation().execute()`;
7. catch and map a failed normalized error;
8. run the success callback;
9. reset values when `resetOnSuccess` is enabled;
10. release the submission guard in `finally`.

The default duplicate-submit policy is `ignore`: only one submission may be active for a form instance. The implementation should return the active submission promise so callers observe the same eventual result.

The first version will not expose a concurrency option. If a use case genuinely requires concurrent calls, it should use `useConvexMutation` directly.

## Error contract

The composable consumes `ConvexCallError`, never raw `ConvexError`:

```ts
interface ConvexFormServerErrorData {
  code?: string
  field?: string
  message?: string
}
```

When a mutation fails:

1. authentication and transport errors remain form-level errors;
2. a server error may be interpreted from `ConvexCallError.data`;
3. a non-empty `field` matching a known form field receives the message;
4. an unknown `field` becomes a form-level error and retains the original field name for diagnostics;
5. a path without a field becomes a form-level error;
6. `mapServerError` may replace the default presentation mapping but cannot hide the original normalized error from programmatic inspection.

The backend convention is documented, not falsely described as end-to-end statically typed. Convex function references do not encode thrown error variants. Runtime validation is therefore required.

The form-level error should retain the normalized source:

```ts
interface ConvexFormError {
  message: string
  source: 'validation' | 'server' | 'authentication' | 'transport' | 'unknown'
  field?: string
  cause?: ConvexCallError
}
```

The exact public shape must be reviewed against Better Convex Nuxt's rule that runtime-only error causes are never serialized or logged. `ConvexCallError.cause` must not be copied into an enumerable form state object.

## Success and reset behavior

Options:

```ts
interface UseConvexFormOptions<Values, Result> {
  resetOnSuccess?: boolean
  onSuccess?: (result: Result, values: Values) => void | Promise<void>
}
```

`resetOnSuccess` defaults to `true` for the experimental API. This default must be reconsidered from application feedback before declaring the API stable; edit forms often need to retain their submitted value.

`reset()` restores initial values and clears validation, field, and form errors. It does not cancel a mutation already accepted by Convex. Reset during an active submission must not allow the retired result to mutate the reset form state.

## Identity changes and disposal

`useConvexMutation` remains responsible for rejecting or retiring completions from an old identity generation.

The form layer must additionally ensure that:

- a retired completion cannot reset values;
- a retired completion cannot add field errors under the new identity;
- pending state settles when the owning scope is disposed;
- callbacks do not run for retired submissions;
- reset and disposal invalidate the form submission revision.

No form values are persisted automatically across navigation or identity changes.

## Accessibility

The initial implementation exposes enough state for applications to provide accessible markup:

- stable field names supplied by the application;
- `hasError(field)` for `aria-invalid`;
- field-error arrays;
- a form-level error.

Automatic IDs, `aria-describedby`, focus movement, and rendered error components are deferred. They require deterministic SSR IDs and presentation policy that are not necessary to prove the core integration.

## Standard Schema dependency strategy

Better Convex Nuxt must not add a runtime dependency on a specific validation library.

The implementation may either:

1. depend only on the small official Standard Schema types package as a development/type dependency; or
2. define the minimum structurally compatible `~standard` interface locally.

The spike must verify both approaches against package declarations and the packed consumer fixture. The choice should minimize public type leakage and dependency-resolution friction.

Required compatibility fixtures:

- Zod;
- one non-Zod implementation such as Valibot or ArkType;
- an asynchronous validator;
- schema input and output types that differ through transformation.

## Alternatives considered

### Documentation recipe only

A recipe is cheaper and remains useful even if the composable ships. It does not remove repeated error routing, argument typing, concurrency, or reset implementations across applications.

Decision: write the recipe as part of the experiment, then compare it against the composable. If the abstraction does not materially improve correctness and code size, keep only the recipe.

### Recommend an existing Vue form library

Existing form libraries solve broad field management well. They do not generally understand Better Convex Nuxt's normalized errors, identity generations, or typed mutation references.

Decision: do not compete with them broadly. Keep `useConvexForm` narrow enough that a future adapter remains possible without being designed now.

### Add schema support to `useConvexMutation`

This would mix field state and validation policy into the core mutation primitive and complicate every mutation call, including non-form calls.

Decision: rejected. Keep `useConvexMutation` transport-focused.

### Infer values by inspecting Zod

This would simplify examples but couple the package to one validator and rely on library-specific schema internals.

Decision: rejected. Require explicit initial values.

### Keyed `.for(id)` instances

This reduces list-row boilerplate but creates retained registries, cleanup rules, identity questions, and a second component-lifetime system.

Decision: rejected for the first version. Prefer child components and ordinary Vue scopes.

### General concurrent submission counters

This accurately represents multiple active requests but permits a form interaction that usually indicates an accidental duplicate submission.

Decision: rejected for the first version. Guard one active submission and return its promise.

## Testing strategy

The experiment is not complete without all of the following.

### Type tests

- schema output exactly covers mutation arguments;
- schema output covers only form arguments and `submit()` requires the remainder;
- a missing required mutation argument fails;
- an incompatible field type fails;
- overlapping extra arguments fail;
- transformed schema output, rather than editable input, is checked against mutation arguments;
- return data is inferred from `FunctionReturnType<Mutation>`.

### Unit tests

- sync and async Standard Schema validation;
- field, pathless, and unknown-path issue routing;
- known and unknown server field routing;
- transport and authentication errors remain form-level;
- explicit initial values and factory values reset correctly;
- duplicate submissions share one active operation;
- failed validation never invokes the mutation;
- success and error callback failures do not corrupt form state;
- reset during submission retires the form-side completion;
- mutable initial values are not reused by reference.

### Mounted Nuxt/Vue tests

- `v-model` works with the public value shape;
- errors and pending state update in a rendered form;
- a structured Convex application error reaches the expected field;
- a successful mutation resets by policy;
- unmount and identity change prevent stale state commits.

### Package tests

- generated declarations do not require Zod;
- Standard Schema consumers compile from the packed tarball;
- the composable is exported from the intended entry and auto-imported once;
- package export and generated API documentation checks remain green.

## Documentation requirements

The feature documentation must include:

1. a before-and-after invite-member example;
2. a statement that backend validation remains canonical;
3. the structured server-error convention;
4. unknown-field fallback behavior;
5. form fields plus route/context mutation arguments;
6. reset and duplicate-submit behavior;
7. a list-row example using a child component rather than hidden registry state;
8. guidance for choosing `useConvexForm`, `useConvexMutation`, or a dedicated Vue form library.

## Rollout

### Phase 0: proof

Build the minimum internal composable and type fixtures without exporting it. Use the invite-member form as the reference scenario.

Exit criteria:

- all required type relationships are expressible without unsafe public casts;
- Standard Schema input/output transformations work;
- normalized server errors route safely;
- duplicate submission and identity-change tests pass;
- the implementation remains small and delegates mutation execution.

### Phase 1: experimental export

Export the composable with an explicit experimental documentation label. Add the packed-consumer and API-surface checks before release.

Collect feedback specifically on:

- extra mutation arguments;
- initial-value ergonomics;
- default reset behavior;
- server-error payload conventions;
- integration with existing Vue form libraries.

### Phase 2: stability decision

Stabilize only if real consumers demonstrate that the small contract is sufficient. Otherwise either revise it with a hard cutover while experimental or remove it and retain the recipe.

No compatibility shim is required for an experimental API.

## Acceptance criteria

The RFC is accepted for implementation only when the proof demonstrates all of the following:

1. No second mutation, authentication, identity, or error-normalization lifecycle is introduced.
2. No validator-specific runtime dependency is added.
3. Initial values are explicit and reset deterministically.
4. Parsed schema output plus typed extra arguments must satisfy the mutation arguments.
5. Unknown client issue paths and server field names remain visible as form errors.
6. Duplicate submissions cannot create multiple Convex calls by default.
7. Identity changes, reset, and disposal prevent stale form-state commits.
8. The public surface excludes `.for(id)`, field arrays, wizards, autosave, and UI components.
9. Type, unit, mounted, documentation, export, and packed-consumer checks pass.
10. The before-and-after example demonstrates a material correctness improvement, not only fewer lines.

## Open questions

1. Should `resetOnSuccess` default to `true`, or should reset always be explicit?
2. Should a duplicate `submit()` return the active promise or a typed `already_pending` result?
3. Should `mapServerError` return a presentation mapping, mutate a restricted error collector, or receive both options?
4. How should Standard Schema issue paths containing nested objects be preserved without committing to nested field management?
5. Should the experimental export live at the main entry or an explicit subpath until stabilized?

These questions are intentionally limited to the proposed core. They are not invitations to add a general form framework.
