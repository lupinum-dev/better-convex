#!/usr/bin/env sh
# Vercel build entry point. Production builds deploy the Convex functions
# before building Nuxt, so the frontend never ships ahead of its backend.
# Preview builds deploy no backend and only build the frontend.
#
# This calls the plain Convex CLI on purpose: `better-convex convex deploy`
# reads its deployment only from .env.local, which does not exist on Vercel.
# The Convex CLI reads CONVEX_DEPLOY_KEY from the Vercel environment.
set -eu

if [ "${VERCEL_ENV:-}" = "production" ]; then
  case "${CONVEX_DEPLOY_KEY:-}" in
    prod:*) ;;
    *) echo "CONVEX_DEPLOY_KEY must be a production deploy key." >&2; exit 1 ;;
  esac
  pnpm exec convex deploy
fi

pnpm exec nuxt build
