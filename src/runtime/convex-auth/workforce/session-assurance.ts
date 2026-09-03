import { workforceSessionPolicy } from './operations'

export type WorkforceSessionAssurance = {
  readonly userId: string
  readonly sessionId: string
  readonly generation: number
  readonly authenticatedAt: number
  readonly sessionStartedAt: number
} & ({ readonly method: 'password-totp' } | { readonly method: 'password-recovery' })

interface WorkforceSessionAssuranceInput {
  readonly user: Readonly<Record<string, unknown>> | null | undefined
  readonly session: Readonly<Record<string, unknown>> | null | undefined
  readonly now: number
  readonly absoluteLifetimeMs: number
  readonly maxAuthenticationAgeMs?: number
}

/** Ordinary business access excludes recovery and requires mailbox ownership. */
export function isFullWorkforceSession(
  input: Pick<WorkforceSessionAssuranceInput, 'user' | 'session' | 'now'>,
): boolean {
  return (
    input.user?.emailVerified === true &&
    getWorkforceSessionAssurance({
      ...input,
      absoluteLifetimeMs: workforceSessionPolicy.absoluteLifetimeMs,
    })?.method === 'password-totp'
  )
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function generation(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Read evidence from live canonical rows, never client claims or account flags.
 * This is not application authorization: callers must distinguish recovery
 * from full TOTP assurance and separately check mailbox ownership/permissions.
 * Freshness and absolute lifetime expire at their exact boundary. No activity
 * or idle lifetime is inferred from session refresh or polling.
 */
export function getWorkforceSessionAssurance({
  user,
  session,
  now,
  absoluteLifetimeMs,
  maxAuthenticationAgeMs,
}: WorkforceSessionAssuranceInput): WorkforceSessionAssurance | null {
  if (
    !user ||
    !session ||
    !positiveInteger(now) ||
    !positiveInteger(absoluteLifetimeMs) ||
    (maxAuthenticationAgeMs !== undefined && !positiveInteger(maxAuthenticationAgeMs))
  ) {
    return null
  }

  const userId = user.id
  const sessionId = session.id
  const userGeneration = user.bcnSecurityGeneration
  const sessionGeneration = session.bcnAssuranceGeneration
  const method = session.bcnAssuranceMethod
  const authenticatedAt = session.bcnAuthenticatedAt
  const sessionStartedAt = session.bcnSessionStartedAt
  const expiresAt = session.expiresAt

  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    session.userId !== userId ||
    !generation(userGeneration) ||
    !generation(sessionGeneration) ||
    userGeneration !== sessionGeneration ||
    (method !== 'password-totp' && method !== 'password-recovery') ||
    !positiveInteger(authenticatedAt) ||
    !positiveInteger(sessionStartedAt) ||
    !positiveInteger(expiresAt) ||
    sessionStartedAt > authenticatedAt ||
    authenticatedAt > now ||
    expiresAt <= now ||
    now - sessionStartedAt >= absoluteLifetimeMs ||
    (maxAuthenticationAgeMs !== undefined && now - authenticatedAt >= maxAuthenticationAgeMs)
  ) {
    return null
  }

  const evidence = {
    userId,
    sessionId,
    generation: userGeneration,
    authenticatedAt,
    sessionStartedAt,
  }
  return method === 'password-totp'
    ? { ...evidence, method: 'password-totp' }
    : { ...evidence, method: 'password-recovery' }
}
