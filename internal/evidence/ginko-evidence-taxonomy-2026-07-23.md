# Ginko evidence taxonomy cleanup — 2026-07-23

## Outcome

Ginko commit `2a1851f7` separates traceability, source wiring, runtime proof, artifact identity, and
performance claims:

- story-title tags produce a non-blocking traceability index and explicitly are not acceptance evidence;
- the release `check` no longer treats that index as a security or behavior gate;
- the refactor report records it under `storyTraceability` with `acceptanceEvidence: false`;
- same-origin package identity is documented as application self-attestation, not independent browser
  certification;
- historical line-count budgets were deleted;
- the `listPaging < 200 ms p95` claim was removed because no retained live sample set supports it;
- target-scale pagination still records every `Load more` duration and sample count as a structured trace
  that can support a future admitted budget.

No AST dependency, security, application behavior, package boundary, exact-artifact, provenance,
observability, target-scale data, or cleanup gate was removed.

## Proof

- Focused story-index and live-proof harness suites: 2 files and 8 tests passed.
- The traceability command reported 111/111 currently indexed accepted stories and 12 explicitly
  deferred stories, while stating that the index is not acceptance evidence.
- Focused lint and repository formatting passed.
- Full Ginko suite: 182 files passed, 1 skipped; 1,202 tests passed, 1 skipped.

An automatic pnpm dependency-state check attempted to fetch unpublished Better Convex beta.15 packages
and temporarily removed their local links. The test failures from that intermediate environment were
package-resolution failures only. The exact certified beta.15/beta.5 tarballs already retained in
Ginko's candidate directory were restored without changing manifests or the lockfile; all 14 affected
suites then passed (147 tests), followed by the clean full-suite result above.

## Commit

- Ginko `2a1851f7` — separate story traceability and self-attestation from acceptance proof and remove
  the unsupported paging budget.
