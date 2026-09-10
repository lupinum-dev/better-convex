# Active migrations

## Beta.3 user-generation backfill

- **Why it exists:** Populated beta.3 Better Auth user rows do not contain the
  generation field required by beta.4 and later.
- **Introduced:** 2026-09-10.
- **Dependencies:** Three pre-customer application-owned beta.3 components need
  one reviewed in-place user migration after their legacy sessions are deleted.
  User IDs, accounts, passwords, and application references must remain stable.
- **Removal condition:** Remove the operator function, tests, public procedure,
  and this entry after all three production components run the strict target
  schema and their rollback windows close.
- **Tracking issue:** Create the issue before publishing the migration release.
