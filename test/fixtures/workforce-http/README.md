# Workforce HTTP fixture

This fixture proves the workforce profile with real Better Auth HTTP requests
and one local Convex auth component. It does not use a memory auth adapter.

Build the package before running `node scripts/run-workforce-auth.mjs` from the
repository root. The runner does not build the package. It copies this fixture
into a new temporary directory, generates its schema and API, and starts the
reviewed anonymous local backend. It removes the temporary directory after the
backend stops.

The proof covers password-only enrollment, pending-factor confirmation, a new
password and TOTP sign-in, full backend admission, restricted recovery, and
revocation of the previous token at a live backend check.

The runner uses the local admin connection to mark its synthetic account's
mailbox as verified. This is a test precondition, not an email-verification
proof. It sends no email and does not test password-reset delivery. No public
fixture function returns credentials or component records.
