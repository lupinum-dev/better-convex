# Active migrations

## Beta.3 session-generation backfill

- **Why it exists:** Populated beta.3 Better Auth user and session rows do not
  contain the generation fields required by beta.4 and later.
- **Introduced:** 2026-09-10.
- **Dependencies:** Populated application-owned beta.3 components need one
  reviewed in-place migration that preserves Better Auth IDs, sessions, and
  application references.
- **Removal condition:** Remove the operator function, tests, public procedure,
  and this entry after all three production components run the strict target
  schema and their rollback windows close.
- **Tracking issue:** Create the issue before publishing the migration release.
