---
'@lupinum/better-convex-nuxt': minor
'@lupinum/better-convex-vue': minor
---

Change the auth factory to safe defaults: password sign-in is off unless you pass `emailAndPassword`, and identity gaps are closed

Password sign-in needs verified addresses and a password reset ends every earlier session. A password change always ends the other sessions (no opt-out), and verifying an address ends earlier sessions.
Users with an unverified email are created only by password sign-up (and anonymous guests): unverified social users are refused. `beforeUserCreate` can no longer swap the email (letter case only, stored lower case).
`twoFactor` is rejected with `emailOTP` or `socialProviders`, and `socialProviders.*.overrideUserInfoOnSignIn` is rejected. Email codes are stored hashed, `emailOTP.changeEmail` is rejected, email-code password reset needs `emailAndPassword.passwordReset`, and organization invitations need a verified email.
Without an `email` hook, a loopback `SITE_URL` logs mail to the Convex log (dev outbox); with another `SITE_URL` set, `createBetterConvexAuth` fails when mail is needed. With `SITE_URL` unset it loads, and sending mail fails with an error that names the `email` hook.
`convex.auth.origin` accepts `process.env.SITE_URL` as is. `init` writes `emailAndPassword: {}`; docs and starters drop the localhost fallback.
Migration: pass `emailAndPassword: {}` to keep password sign-in (add `requireEmailVerification: false` to keep sign-in before verification), add an `email` hook before deploying, remove `overrideUserInfoOnSignIn`, drop `twoFactor` from apps with `emailOTP` or social sign-in, and use email codes where access depends on the email.
