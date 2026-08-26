# RFC: Prove data-model-native user projection types

- Status: Rejected after proof; retain the current public types
- Date: 2026-08-25
- Target: After the projection integrity decision in PR #113
- Scope: Public TypeScript contract of `createUserProjectionTriggers`
- Decision owner: Better Convex maintainers

## Summary

`createUserProjectionTriggers` currently accepts table, index, and auth ID field names as general strings. Its callbacks use caller-supplied document and context generics and return `Record<string, unknown>`. Invalid table, index, field, insert, and patch combinations can compile.

This RFC proposes an all-or-nothing type proof using only public `convex/server` types. The ordinary call should provide one explicit application `DataModel` type. The selected table must then determine the eligible index, auth ID field, existing document, mutation context, create document, and patch document.

This is a proof, not a predetermined API decision. Better Convex adopts the signature only if it materially improves consumer inference without casts, builders, currying, compatibility overloads, slow type checking, or copied Convex type machinery.

If any admission gate fails, delete the proof and retain the current public types.

## Decision requested

Approve a time-boxed experiment with one candidate signature:

```ts
createUserProjectionTriggers<
  DataModel extends GenericDataModel,
  AuthUser extends BetterAuthUserProjectionSource = BetterAuthUserProjectionSource,
>(options: CreateUserProjectionTriggersOptions<DataModel, AuthUser>)
```

The common application supplies only `DataModel`. An application with additional Better Auth user fields may supply `AuthUser` as the second and final generic.

The proof must not add another public function, runtime value, schema argument, compatibility signature, or exported helper family.

## Why this needs a separate decision

The projection integrity RFC corrects destructive runtime behavior. It does not need a public type redesign.

Changing the generic order and callback types is a separate breaking contract. It can improve correctness, but advanced mapped types can also produce worse inference, slow editors, unstable declarations, and error messages that are harder than the current explicit generics.

Separating the proof keeps the data-loss correction direct. The type experiment must earn adoption independently.

## Current contract

The current helper uses:

- `string` for `table`, `index`, and `authIdField`;
- a handwritten query-chain shape;
- a caller-provided `TExistingUser`;
- a caller-provided `TCtx`;
- `Record<string, unknown>` for create and patch output;
- the generic order `<TAuthUser, TExistingUser, TCtx>`.

The maintained example supplies `BetterAuthUserProjectionSource` and `Doc<'users'>` explicitly. The helper cannot prove that:

- the table exists;
- the index belongs to the table;
- the auth ID field is the first field of the index;
- the auth ID field is a required string;
- the existing document comes from the selected table;
- a create document contains required application fields;
- a patch uses valid fields and values.

Runtime Convex schema validation remains authoritative. The question is whether the package can reject more invalid configuration before deployment without making the API worse.

## Type relationship under proof

The candidate options type may use a mapped union over application tables and eligible indexes.

| Input or callback value | Required source type                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `table`                 | `TableNamesInDataModel<DataModel>`                               |
| `index`                 | `IndexNames<NamedTableInfo<DataModel, Table>>`                   |
| `authIdField`           | First declared field of the selected index                       |
| `existing`              | `DocumentByName<DataModel, Table>`                               |
| `ctx`                   | `GenericMutationCtx<DataModel>`                                  |
| `createDoc` output      | Selected table insert value without the helper-owned auth ID     |
| `patchDoc` output       | Selected table patch value without system or helper-owned fields |
| `rebuildDoc` output     | Same constraints as `patchDoc`                                   |

Only indexes whose first field is a top-level required `string` field are eligible. An index that contains the auth ID later is not sufficient because Convex index equality constraints follow declared field order.

`authIdField` may remain optional only when the selected index begins with the existing runtime default, `authId`. For every other eligible index, the application must supply the exact first-field literal. Type-only metadata must not create a second runtime default.

The proof may extract insert and patch parameters from public `BaseTableWriter` methods. It must not copy Convex's private patch or query types.

## Runtime invariants that remain

The proof changes types only. It must not change emitted runtime behavior.

The implementation must retain:

- runtime validation of the top-level auth ID field;
- canonical auth ID injection after callback output;
- the cardinality behavior selected by the projection integrity RFC;
- Better Auth as the canonical user source;
- application ownership of non-auth projection fields;
- the existing server package entry and export enforcement.

Compile-time checks are defense in depth. They do not replace Convex schema enforcement or runtime conflict handling.

## Admission gates

All gates are mandatory.

### Consumer inference

1. The maintained common call uses one explicit type argument: `DataModel`.
2. A custom auth user uses exactly one additional `AuthUser` generic.
3. Callback parameters need no annotations or projection-related casts.
4. Consumer-visible types contain no `any`, broad `unknown`, broad `string`, or union of documents from unrelated tables.
5. The generated declaration is understandable enough for ordinary editor hovers and errors.

### Relationship correctness

6. The selected index belongs to the selected table.
7. The auth ID is the first declared index field and a required top-level string.
8. `existing` is the exact selected table document.
9. `ctx` is the application mutation context.
10. Create output requires every required non-system, non-auth-ID field.
11. Patch and rebuild output preserve Convex optional-field removal with `undefined`.
12. Direct callback object literals reject system, helper-owned, unknown, and incorrectly typed fields where normal TypeScript excess-property checks apply.

TypeScript structural typing can allow extra fields that arrive through an already typed variable. The proof must document this normal language limit. It must not introduce an `Exact<>` type, callback generic, or wrapper to simulate exact objects.

### Dependency and declaration compatibility

13. The implementation imports only public types from `convex/server`.
14. Source and packed consumers pass at the peer floor, `convex@1.42.2`.
15. Source and packed consumers pass at the newest supported Convex version below 2 selected by the release matrix.
16. The proof does not require narrowing the existing Convex peer range solely for this helper.
17. Emitted server-entry declarations contain no private Convex path or new public helper export.

### Performance and complexity

18. Median focused type-check time across five warm runs regresses by no more than 15 percent.
19. No test or maintained consumer reports excessive type instantiation or an editor timeout.
20. The emitted server-entry declaration grows by no more than 20 percent.
21. The implementation needs no builder, currying, overload, registry, schema value, compatibility alias, or handwritten database abstraction.

Failure of one gate rejects the entire signature. Partial typing, such as a typed table with broad indexes and callbacks, is not enough to justify a breaking change.

## Positive type matrix

The proof must compile:

- a generated application `DataModel` with a valid table, index, and required string auth ID;
- the default `authId` field without an explicit `authIdField`;
- a custom auth ID field supplied explicitly;
- a compound index with the auth ID first;
- the default Better Auth user shape with one generic;
- a custom Better Auth user shape with two generics;
- synchronous and asynchronous create, patch, and rebuild callbacks;
- a complete create document without the helper-owned auth ID;
- a partial patch;
- removal of an optional field with `undefined`;
- compiler configurations with `exactOptionalPropertyTypes` both disabled and enabled;
- source and packed package entries at the Convex peer floor and selected newest supported version.

Callback hovers must infer the selected application document and mutation context without annotations.

## Negative type matrix

Consumed `@ts-expect-error` assertions must reject:

- an unknown table;
- an unknown index;
- an index from another table;
- a system-field-first index;
- a compound index with the auth ID second;
- a nested first field;
- a numeric, optional, nullable, or mixed-type auth ID field;
- an `authIdField` different from the selected index's first field;
- a create result missing a required application field;
- a direct create object containing `_id`, `_creationTime`, the helper-owned auth ID, an unknown field, or a wrong value type;
- a direct patch or rebuild object containing system, helper-owned, unknown, or incorrectly typed fields;
- use of the existing document as a document from another table;
- an invalid table or document operation through callback `ctx.db`;
- the old `<AuthUser, Doc>` generic order;
- a broad dynamic string that erases the literal table, index, or field relationship.

The test must prove that each `@ts-expect-error` directive is necessary. Assertions used only to force the positive API to compile invalidate the proof.

## Packed-consumer proof

The existing map-based projection fixture is useful runtime evidence, but it cannot prove generated `DataModel` inference.

The proof needs one isolated packed consumer with:

- a generated-style application `DataModel`;
- positive inferred calls using only published package entries;
- the negative type matrix;
- no workspace source import;
- no projection-related cast;
- exact package tarballs;
- both supported `exactOptionalPropertyTypes` modes;
- the Convex peer floor and selected newest supported version.

Runtime mocks may remain separate from this type fixture. Public consumer types must not be weakened to fit a fake database.

## Public API and migration

If admitted, this is one prerelease hard cut:

- replace the old generic order;
- update maintained consumers and documentation in the same change;
- add no legacy overload or deprecated alias;
- export no new runtime value;
- retain the existing package subpath;
- call out the required `DataModel` generic in release notes.

The package is prerelease, so a one-time source migration is cheaper than a permanent compatibility signature.

## Explicit rejections

The proof must not add:

- `createUserProjectionTriggers<DataModel>()(...)` currying;
- `defineUserProjection` or another public function;
- a runtime schema or data-model argument;
- a projection registry or builder;
- a table wrapper;
- a generic projection package;
- a compatibility overload;
- an optional loose mode;
- public `EligibleIndex`, `ProjectionInsert`, or `ProjectionPatch` helpers unless declaration emission makes one unavoidable;
- imports from Convex private paths;
- copied `PatchValue`, index, query, or database types;
- `Exact<>` machinery for structural object exactness;
- a cast presented as consumer inference.

## Rejection outcome

If the proof fails, Better Convex retains the current public types and documents the limitation. Applications can continue to supply their generated `Doc` and context types directly.

The rejected proof must be deleted completely. It must leave no overload, helper type, fixture, configuration option, or compatibility path.

## Proof result

The experiment was implemented against Convex 1.42.2, then deleted because it
failed admission gate 20.

The candidate successfully proved the core relationships with public
`convex/server` types:

- one explicit generated `DataModel` selected the table, index, auth ID field,
  document, mutation context, insert value, and patch value;
- the positive and negative type matrix compiled without excessive type
  instantiation;
- both ordinary and `exactOptionalPropertyTypes` callback shapes compiled;
- five warm focused server type-check runs had medians of 2.93 seconds before
  and 3.29 seconds with the proof, a 12.3 percent regression within the
  15 percent budget.

However, the emitted `user-projection.d.ts` grew from 3.71 kB to 5.99 kB, a
61.5 percent increase. This is more than three times the allowed 20 percent
growth. The extra mapped and conditional types would become permanent public
API complexity for a helper whose runtime contract is already explicit.

Per the all-or-nothing admission rule, the implementation, type fixtures,
consumer changes, configuration changes, and migration edits were removed.
There is no overload, compatibility path, helper export, or residual type
machinery. The current `<TAuthUser, TExistingUser, TCtx>` contract remains.

## Decision

Rejected. Do not adopt the data-model-native signature under the current
declaration-size budget. Reopen only if Convex exposes a materially smaller
public projection type primitive or a future TypeScript release emits the same
contract within all admission gates.
