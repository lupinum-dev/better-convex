# Runtime-fingerprint profile evidence — 2026-07-22

## Outcome

`P2-011` moves runtime-fingerprint policy out of universal Nuxt constants and behind the closed package
descriptor. The selected `nuxt-runtime-binding` profile retains exactly one build token, one packed
helper, and one module binding. Release creation replaces the token once, restores build output after
packing, and records the generated fingerprint. Verification requires the recorded value exactly once
in the helper and requires the packed module to import that helper exactly once.

The policy has two deliberately small modes:

- `required`: evidence must contain `bcn-release-v1-` plus 64 lowercase hexadecimal characters and the
  packed binding must pass; and
- `forbidden`: evidence must contain `null` and any placeholder, generated-looking value, or omitted
  field fails.

There is no optional mode. The repository has no library-only public package yet, so no unused package
profile or descriptor was added. The forbidden-mode invariant is tested through the internal policy
seam and can be assigned only when a future package passes its RFC admission gate.

## Executed proof

```sh
pnpm exec vitest run \
  test/unit/package-runtime-fingerprint-profile.test.ts \
  test/unit/release-artifact-evidence.test.ts \
  test/unit/release-workflow.test.ts \
  --reporter=dot
```

Result: three files and 50 tests passed. Coverage includes exact Nuxt profile selection, required valid
evidence, missing/malformed/placeholder rejection, forbidden-profile fake rejection, malformed profile
rejection, packed helper mismatch, module binding mismatch, and closed release workflow behavior.

Focused ESLint and formatting passed for the policy, evidence parser, release packer/verifier, and tests.
`git diff --check` passed before commit.

## Preserved boundary

The artifact evidence schema remains strict and retains the `runtimeFingerprint` field. Nuxt artifact
bytes and runtime behavior are unchanged. No public API, dependency, package, second binding mechanism,
or speculative library descriptor was added.
