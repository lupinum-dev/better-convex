import { v, type Infer } from 'convex/values'

const identity = { userId: v.string(), expectedGeneration: v.number() }

/** Non-secret provider evidence; canonical factor and counter checks remain required. */
export const workforceReplayProofValidator = v.object({
  digest: v.string(),
  userId: v.string(),
  factorId: v.string(),
  factorFingerprint: v.string(),
  matchingCounters: v.array(v.number()),
})
export type WorkforceReplayProof = Infer<typeof workforceReplayProofValidator>

/** Internal server-to-component metadata, never an HTTP request schema. */
export const workforceOperationValidator = v.union(
  v.object({
    ...identity,
    operation: v.union(
      v.literal('begin-enrollment'),
      v.literal('confirm-enrollment'),
      v.literal('regenerate-backup-codes'),
      v.literal('change-password'),
    ),
    sessionId: v.string(),
    replay: v.optional(workforceReplayProofValidator),
  }),
  v.object({ ...identity, operation: v.literal('password-sign-in') }),
  v.object({
    ...identity,
    operation: v.literal('password-challenge'),
    challengeId: v.string(),
  }),
  v.object({
    ...identity,
    operation: v.union(v.literal('totp-sign-in'), v.literal('recovery-sign-in')),
    challengeId: v.string(),
    replay: v.optional(workforceReplayProofValidator),
  }),
)

export type WorkforceOperation = Infer<typeof workforceOperationValidator>

/** One committed primary-consumption receipt, not standalone MFA proof. */
export const workforceConsumedChallengeValidator = v.object({
  ...identity,
  operation: v.union(v.literal('totp-sign-in'), v.literal('recovery-sign-in')),
  challengeId: v.string(),
  expiresAt: v.number(),
})

export type WorkforceConsumedChallenge = Infer<typeof workforceConsumedChallengeValidator>

export const workforceSessionPolicy = Object.freeze({
  idleTimeoutMs: 60 * 60 * 1_000,
  absoluteLifetimeMs: 12 * 60 * 60 * 1_000,
  freshAuthenticationMs: 5 * 60 * 1_000,
})
