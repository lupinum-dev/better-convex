---
'@lupinum/better-convex-nuxt': minor
'@lupinum/better-convex-vue': minor
---

Change the auth factory to safe defaults: password sign-in is off unless you pass `emailAndPassword`, and identity gaps are closed

Password sign-in needs verified addresses and ends other sessions on reset or password change by default. Verifying an address ends earlier sessions.
Users with an unverified email are created only by password sign-up. `beforeUserCreate` can no longer swap the email (letter case only, stored lower case).
`twoFactor` is rejected with `emailOTP` or `socialProviders`. Email codes are stored hashed, `emailOTP.changeEmail` is rejected, and organization invitations need a verified email.
Without an `email` hook, a loopback `SITE_URL` logs mail to the Convex log (dev outbox); any other `SITE_URL` fails at `createBetterConvexAuth` when mail is needed.
`convex.auth.origin` accepts `process.env.SITE_URL` as is; the build names SITE_URL when it is missing. Docs and starters drop the localhost fallback.
Migration: pass `emailAndPassword: {}` to keep password sign-in (add `requireEmailVerification: false` to keep sign-in before verification), add an `email` hook before deploying, and apps that decide access by email should use email codes.
