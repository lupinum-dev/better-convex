import type { BetterConvexAuthEmail } from './create-better-convex-auth'
import { isExactLoopbackHost } from './origin'

/**
 * True when `SITE_URL` is an exact loopback origin (`localhost`, `127.0.0.1`,
 * `[::1]`). This is the only signal for "local development": `NODE_ENV` is not
 * set on a Convex deployment, so it never decides anything here.
 */
export function isLoopbackSiteUrl(siteUrl: string | undefined): boolean {
  if (!siteUrl) return false
  try {
    return isExactLoopbackHost(new URL(siteUrl).hostname)
  } catch {
    return false
  }
}

/**
 * Local development only: writes each auth email to the Convex function log so
 * a new project can sign in before any mail provider exists. The factory uses
 * it only when no `email` hook is set and `SITE_URL` is a loopback origin; on
 * any other deployment the log must never hold codes or links.
 */
export async function devOutbox(message: BetterConvexAuthEmail): Promise<void> {
  const secret =
    message.type === 'email-otp' || message.type === 'two-factor-otp'
      ? `code ${message.otp}`
      : message.type === 'organization-invitation'
        ? `invitation ${message.invitationId}`
        : message.url
  console.log(`[better-convex dev outbox] ${message.type} to ${message.to}: ${secret}`)
}
