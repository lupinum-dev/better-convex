# ADR: Better Convex Vue boundary

- Status: Accepted for vNext implementation
- Date checked: 2026-07-22
- Decision task: `P3-017`

## Decision

Build `better-convex-vue` from the one lifecycle implementation already used by
`better-convex-nuxt`. Depend directly on `convex/browser` and Vue. Do not wrap, fork, copy, or depend on
the community `convex-vue` package.

Seek upstream collaboration on shared lifecycle invariants and API ergonomics, but do not treat that as
a substitute for the proven identity-generation, stale-work, pagination, callable, and embedded-runtime
contract required by Nuxt and the neutral Vite consumer.

## Current ecosystem

Convex's published [Vue quickstart](https://docs.convex.dev/quickstart/vue) explicitly describes its Vue
client as community maintained and installs `convex-vue`. The official `convex` package exposes
`convex/browser` as the framework-neutral reactive client and documents that third-party clients may
wrap it for additional control:

- [Convex JavaScript clients](https://docs.convex.dev/client/javascript/overview)
- [ConvexClient API](https://docs.convex.dev/api/classes/browser.ConvexClient)
- [`convex-vue` source](https://github.com/chris-visser/convex-vue)

Exact package inspected:

```text
convex-vue@0.1.5
modified: 2025-07-17T07:36:11.226Z
integrity: sha512-0kyM4rkGzDDW9mrK4O3q9cCByzezBm6cnjfeB+i5Wc/BNKfXeAWKFyOKvAuCqjC8WGCbUG/OtbMFbUlWT3dD3g==
peers: convex >=1.24.0, vue >=3.5.0
```

An additional community package, `@adinvadim/convex-vue@1.3.0`, was inspected as ecosystem context. It
has more features, but it is not the package selected by Convex's quickstart and does not change the
decision below.

## Direct-reuse attempt

The exact registry bytes of `convex-vue@0.1.5` were installed with `convex@1.42.2` and `vue@3.5.27`.
A fake `ConvexClient` drove an actual `useConvexQuery` instance through:

1. page-one subscription and result;
2. reactive arguments changing to page two;
3. the retired page-one callback firing after unsubscribe;
4. scope disposal;
5. the retired page-two callback firing after disposal.

Observed result:

```json
{
  "version": "convex-vue@0.1.5",
  "firstStopped": true,
  "afterRetiredArgs": "stale-page-1",
  "secondStopped": true,
  "afterDispose": "after-dispose",
  "subscriptionCount": 2
}
```

The package correctly called both unsubscribe functions, but queued callbacks still committed because
the callbacks had no operation or disposal fence. This fails a Better Convex core invariant; wrapping
the composable cannot safely interpose on those closed-over commits.

## Capability and invariant comparison

| Required Better Convex behavior                                  | `convex-vue@0.1.5` exact bytes | Proven private source island |
| ---------------------------------------------------------------- | ------------------------------ | ---------------------------- |
| Plain Vue query subscription                                     | Yes                            | Yes                          |
| Mutation and optimistic-update entry point                       | Yes                            | Yes                          |
| Action lifecycle                                                 | No                             | Yes                          |
| Paginated query lifecycle                                        | No                             | Yes                          |
| Provider-neutral auth settlement                                 | No                             | Yes, token-free observer     |
| Stable handle across underlying client replacement               | No; raw client is injected     | Yes                          |
| Identity key plus same-user generation fencing                   | No                             | Yes                          |
| Retired-argument callback rejection                              | No; executed failure above     | Yes                          |
| Retired-disposal callback rejection                              | No; executed failure above     | Yes                          |
| Awaited mutation/action rejection after identity change          | No                             | Yes                          |
| Empty continuation pages and live pagination-tail reconciliation | No pagination                  | Yes                          |
| Opaque attachment across separate Vue copies                     | No                             | Yes                          |
| Sanitized common error model                                     | No; raw errors                 | Yes                          |
| Nuxt request-isolated SSR/hydration adapter                      | Generic one-shot SSR only      | Yes                          |

## Alternatives rejected

### Depend on and wrap `convex-vue`

Rejected. A wrapper would retain its raw client ownership and unfenced callbacks while adding Better
Convex state beside it. That creates two lifecycle sources and cannot repair commits that occur inside
the upstream closure.

### Fork or copy its composables

Rejected. The proven Nuxt-used controllers already meet the stronger contract. Copying another engine
would increase code and migration risk.

### Wait for an official Convex Vue client

Rejected as a blocking strategy because no official Vue client is currently published, and the current
Nuxt plus neutral Vite consumers already require the semantics. If Convex later ships an official
client meeting the invariant matrix, replacement is preferable to maintaining redundant code.

### Publish only low-level controllers

Rejected by the RFC. Ordinary applications should receive a small Vue plugin/composable surface, not a
public core package or lifecycle assembly kit.

## Collaboration path

Before stable publication, share the reproducible stale-callback case and the invariant matrix with the
`convex-vue` maintainer and Convex. Prefer upstream alignment on names and behavior where it does not
weaken the contract. External coordination is valuable but is not evidence that direct reuse is safe.

## Consequences

- Phase 4 may create `better-convex-vue` only by moving the proven source once and deleting Nuxt's old
  path in the same hard cut.
- The package should expose the smallest plugin and query/pagination/mutation/action composables, not
  raw controllers.
- The stable client handle, identity observer, and attached runtime remain private/opaque unless each
  public symbol separately passes the RFC admission test.
- Exact Vite and embedded tarball consumers remain release gates.
- A future official client that passes this matrix triggers a replace-versus-maintain review.
