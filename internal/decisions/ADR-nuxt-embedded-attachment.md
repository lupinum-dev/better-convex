# ADR: Nuxt embedded-runtime attachment

- Status: accepted for implementation
- Date: 2026-07-22
- Task: `P4-017`
- Amends: `D-013`, `D-015`

## Context

`better-convex-vue/embedded` already exposes the frozen, token-free attachment required by a separately
bundled Vue application. Nuxt constructs that exact attachment, but only the module's internal
`$convexRuntime` injection can currently read it. That injection also contains logger, auth-controller,
DevTools, and disposal controls and is explicitly documented as an internal inter-plugin seam.

The clean RFC Ginko baseline at `a760bfd03d5fc444c05d745df5d1212370cd1ecd` demonstrates the real
failure mode: its Nuxt host passes a stable four-method client plus Better Auth presentation refs, and
the embedded Studio reconstructs identity, query, pagination, mutation, and action lifecycle around
that partial bridge. The generic engines occupy 1,078 lines before host and policy adapters. Ginko
must not replace that with direct `$convexRuntime` access or another identity adapter.

## Decision

Add one Nuxt client composable:

```ts
useConvexAttachment(): BetterConvexAttachment
```

It returns the already-owned frozen attachment from the current Nuxt app. It creates no client,
observer, ref, cache, state machine, or subscription. It throws on the server or when the browser
runtime is unavailable. The attachment retains the public `better-convex-vue/embedded` allowlists:

- stable `query`, `mutation`, `action`, and `onUpdate` handles;
- an anonymous stable handle;
- identity `snapshot`, `subscribe`, and settlement;
- optional connection observation.

It does not expose the `ConvexRuntimeContext`, raw `ConvexClient`, token fetcher, Better Auth client,
session refs, logger, DevTools sink, replacement, auth-controller, or disposal controls.

## Public API admission

1. **Repeated problem:** Nuxt hosts embedding a separately bundled Vue app need the host's exact
   identity generation and stable client without sending credentials. Ginko and the neutral embedded
   production consumer require the same boundary.
2. **Official direct solution:** Vue provide/inject cannot cross separate Vue copies; Convex exposes a
   raw client but no token-free cross-bundle identity observer.
3. **Existing simplification:** return the attachment Nuxt already owns. Do not construct, copy, or
   adapt another runtime.
4. **Two consumers:** the neutral production Nuxt-host/embedded fixture and Ginko Studio's recorded
   bridge requirement. Ginko execution remains required before stabilization.
5. **Source of truth:** the one Vue runtime installed by the Nuxt plugin. The embedded app owns only a
   disposable projection.
6. **Expensive state:** none. The composable is a checked read of per-app state.
7. **Discard:** the embedded Vue plugin unsubscribes its local identity projection on unmount; the host
   attachment remains owned by Nuxt.
8. **Invalid states:** server use and missing runtime fail immediately; consumers cannot receive the
   broader internal context.
9. **Authorization:** unchanged. Every application Convex function rechecks current authority.
10. **Packed proof:** the source contract receives focused Nuxt proof now. `P4-018` must then prove the
    exact installed Nuxt and Vue bytes through a production Nitro host and separately bundled embedded
    Vue consumer with credential sentinels before stabilization. The historical candidate is not
    repacked to manufacture that evidence.
11. **Deletion:** Ginko deletes direct subscription/generation/tail/callable engines and stops passing
    client plus auth refs as lifecycle authority.
12. **Failure and rollback:** before publication remove the composable and retain the current internal
    runtime. No persistent state or data migration exists.

## Release consequence

The immutable `0.8.0-beta.0` pair remains valid historical evidence but does not contain this API and
must not be repacked or published as the changed source. After the authorized Ginko hard cut, a new
versioned pair is built once from clean HEAD and receives the complete package-set certification.
