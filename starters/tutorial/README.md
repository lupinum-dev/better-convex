# Tutorial starter

The finished app of the [Better Convex quick start](https://better-convex.lupinum.com/docs/get-started/installation): a live todo list with sign-in by email code, where each todo belongs to one user.

## Includes

- `/`: sign-in with a code sent by email. The same form creates the account on the first sign-in.
- `/todos`: the protected todo list. Add, complete and delete todos; every open tab updates live.
- `convex/todos.ts`: each function checks the signed-in user, and a user can read and change only their own todos.
- `convex/todos.test.ts`: tests for the owner checks, anonymous callers and text validation.

## Run it

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs `better-convex-nuxt dev`. The first start downloads a Convex backend for your computer, writes its URL to `.env.local`, and starts Nuxt at `http://localhost:3000`. You need no Convex account.

Set up auth once, in a second terminal while `pnpm dev` runs:

```bash
pnpm exec better-convex-nuxt auth init
```

It keeps the auth files of this starter, and sets `SITE_URL`, the secrets and the first signing key. It writes `SITE_URL` and `BCN_AUTH_PROXY_IP_SECRET` to `.env.local`. Then stop `pnpm dev` with Ctrl-C and start it again.

Sign in with any address. Without an `email` hook, the code appears in the `pnpm dev` output, in a line with `[better-convex-nuxt dev outbox]`.

## Check it

```bash
pnpm test
pnpm typecheck
```

## Before you deploy

Add an `email` hook to `convex/auth.ts` so codes are mailed. A deployment whose `SITE_URL` is not `localhost` refuses to start without it. See [Transactional auth email](https://better-convex.lupinum.com/docs/build/authentication/transactional-email) and [Deployment](https://better-convex.lupinum.com/docs/operations/deployment).
