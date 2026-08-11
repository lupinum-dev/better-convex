# Packed provider-neutral Vue authentication proof

Date: 2026-07-22

Task: `P4-005`

## Outcome

An isolated production Vite application installs the exact locally packed
`better-convex-vue@0.8.0-beta.0` tarball and supplies a custom provider-neutral browser auth adapter.
The public package—not package source or an internal export—owns the Convex clients, confirmation,
replacement, identity generations, refresh, failure recovery, safe attachment, and disposal.

The fixture aliases only `convex/browser` to a deterministic transport double. This avoids adding a
public client-injection seam solely for testing while preserving the package's public construction and
auth-adapter path. Real pinned Convex client integration remains covered by the existing Nuxt/browser
and lifecycle matrices.

## Executed proof

```text
pnpm check:vue-auth-consumer
pnpm exec eslint scripts/check-vue-auth-consumer.mjs \
  test/fixtures/vue-authenticated/src
```

The runner built and packed Vue once, installed the tarball in a fresh pinned-pnpm root, typechecked
installed declarations, built 58 production Vite modules, served the production output, and drove it
with a real headless browser.

The executed matrix proved:

- initial loading is unsettled and token-free;
- anonymous settlement;
- server-confirmed Alice authentication;
- same-session provider refresh without identity-generation change;
- explicit refresh with exactly one token fetch;
- same-user new-session retirement;
- Alice-to-Bob replacement;
- late credential rejection fails closed;
- recovery to a new authenticated subject;
- revocation to anonymous;
- provider error projection with private cause redaction;
- an exact four-method stable client handle and allowlisted attachment;
- no credential or private provider error in safe snapshots, DOM, or bundle; and
- listener/client cleanup on Vue unmount.

The fixture contains no Better Auth dependency or concept. It demonstrates that Better Auth remains a
Nuxt adapter choice rather than part of the Vue authentication contract.
