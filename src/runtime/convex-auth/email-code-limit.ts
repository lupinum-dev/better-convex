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

async function addressKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.trim().toLowerCase()),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
  return `email-code-address:${hex.join('')}`
}

/**
 * Better Auth limits email-code requests per client IP only, so many IPs can
 * flood one inbox. This applies the same rule to each address as well, before
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
            const email = (context.body as { email?: unknown } | undefined)?.email
            if (!context.request || typeof email !== 'string' || email.length === 0) return
            const decision = await consume()(await addressKey(email), rule)
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
