# Client lifecycle single-source cleanup — 2026-07-22

## Outcome

Phase 3 ends with one implementation for each client lifecycle concern. The audit did not invent a
second abstraction merely to satisfy cleanup: Nuxt-specific SSR, payload, auth gating, transport, and
DevTools adapters remain because they are framework boundaries, not competing lifecycle engines.

The final duplicate control seam was removed from `CallableController`. It already owned the token-free
identity subscription and disposal, but still returned `onIdentityMaybeChanged()` for manual callers.
That method allowed a second owner to drive the same transition. It is now private to the controller;
tests trigger the real subscription callback.

## Single-owner inventory

| Concern                                        | Authority                                                        | Retired path                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stable replaceable client                      | `client-core/client-owner.ts`                                    | `runtime/client/client-owner.ts`                                                  |
| Identity observer contract                     | `client-core/identity-port.ts`                                   | `runtime/auth/identity-port.ts`                                                   |
| Awaited-call retirement                        | `client-core/identity-changed-error.ts`                          | `runtime/client/identity-changed-error.ts`                                        |
| Query subscription/generation/previous data    | `client-core/query-controller.ts`                                | in-composable ownership                                                           |
| Pagination cursor/subscription/operation state | `client-core/pagination-controller.ts` and `pagination-state.ts` | `utils/paginated-query-pages.ts` and in-composable ownership                      |
| Mutation/action state and identity retirement  | `client-core/callable-controller.ts` and `call-state.ts`         | `utils/callable-lifecycle.ts`, `utils/call-state.ts`, and manual identity control |
| Cross-Vue-copy attachment                      | `client-core/attached-runtime.ts`                                | token/raw-client bridge proposals                                                 |

Repository scans confirm every named retired source path is absent. The private Vite and cross-copy
fixtures remain intentionally: they are the executed Phase 3 consumers and will be replaced by exact
installed-package fixtures only after `packages/vue` exists. Deleting them now would remove proof, not
duplicate production code.

## Rejected metadata extension

`P3-012` required two materially different consumers before admitting arbitrary first-page metadata.
Only Ginko currently needs facet-like metadata. The generic contract is therefore rejected for now;
Ginko keeps that projection in its thin adapter. This avoids a public merge/authority policy based on
one CMS.

## Verification

Focused controller and Nuxt adapter checks passed 35 tests. The canonical repository gate then ran:

```text
pnpm check
```

It passed formatting, lint, module/server/fixture typechecks, all 12 architecture rules over 245 files,
and 164 unit/security/Convex/Nuxt/browser files containing 1,832 tests. `git diff --check` also passed.

The formatter corrected five Phase 3 files that the full canonical check found after their focused
checks; those mechanical changes are included in the cleanup commit rather than leaving a known red
repository gate.
