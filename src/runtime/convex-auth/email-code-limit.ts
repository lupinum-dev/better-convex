import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'

type ConsumeRateLimit = (
  key: string,
  rule: { window: number; max: number },
) => Promise<{ allowed: boolean; retryAfter: number | null }>

/** Endpoints that mail a code to the address in the request body. */
const EMAIL_CODE_PATHS = new Set([
  '/email-otp/send-verification-otp',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
])

// Better Auth's OTP types (email-otp/routes: `types`). An unknown one fails its validation.
const CODE_PURPOSES = new Set(['sign-in', 'email-verification', 'forget-password', 'change-email'])

/**
 * The purpose of the code a request mails, or null for an unknown type. The
 * purpose is part of the key because the send hook mails nothing for some
 * purposes (a verified address, closed reset routes): one shared bucket would
 * let those requests use up the limit for codes a person really waits for.
 */
function codePurpose(path: string, body: { type?: unknown } | undefined): string | null {
  if (path !== '/email-otp/send-verification-otp') return 'forget-password'
  return typeof body?.type === 'string' && CODE_PURPOSES.has(body.type) ? body.type : null
}

async function addressKey(email: string, purpose: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.trim().toLowerCase()),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
  return `email-code-address:${purpose}:${hex.join('')}`
}

/**
 * Better Auth limits email-code requests per client IP only, so many IPs can
 * flood one inbox. This applies the same rule to each address and code purpose as well, before
 * Better Auth stores a code. Like Better Auth's own limits, it covers HTTP
 * requests, not `auth.api` calls from server code. The key is a hash, so the
 * rateLimit table stores no address.
 */
export function createEmailCodeAddressLimitPlugin(
  rule: { window: number; max: number },
  consume: () => ConsumeRateLimit,
): BetterAuthPlugin {
  return {
    id: 'better-convex-email-code-address-limit',
    hooks: {
      before: [
        {
          matcher: (context) => EMAIL_CODE_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (context) => {
            const body = context.body as { email?: unknown; type?: unknown } | undefined
            const email = body?.email
            if (!context.request || typeof email !== 'string' || email.length === 0) return
            // An unknown type is left for Better Auth to reject without using the limit.
            const purpose = codePurpose(context.path ?? '', body)
            if (purpose === null) return
            const decision = await consume()(await addressKey(email, purpose), rule)
            if (decision.allowed) return
            const retryAfter = String(Math.max(1, decision.retryAfter ?? rule.window))
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { message: 'Too many requests. Please try again later.' },
              { 'X-Retry-After': retryAfter },
            )
          }),
        },
      ],
    },
  }
}
