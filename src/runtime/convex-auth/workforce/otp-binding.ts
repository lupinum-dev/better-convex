import type { GenericEndpointContext } from '@better-auth/core'
import { createOTP } from '@better-auth/utils/otp'
import { symmetricDecrypt } from 'better-auth/crypto'

import { fingerprintWorkforceFactor } from './factor-fingerprint'
import type { WorkforceReplayProof } from './operations'

/** Fixed-length comparison; never compare a supplied code through an early-return loop. */
function equalCode(code: string, expected: string): boolean {
  let difference = code.length ^ expected.length
  for (let index = 0; index < expected.length; index++)
    difference |= code.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

/** Additional evidence only: the official provider still verifies and consumes its challenge. */
export async function bindWorkforceTotpReplay(
  ctx: GenericEndpointContext,
  input: { userId: string; expectedGeneration: number; sessionId?: string },
): Promise<WorkforceReplayProof | undefined> {
  const code: unknown = ctx.body?.code
  // Preserve the provider's validation and failed-attempt accounting paths.
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return undefined
  const factor = await ctx.context.adapter.findOne<Record<string, unknown>>({
    model: 'twoFactor',
    where: [{ field: 'userId', value: input.userId }],
  })
  if (!factor || typeof factor.id !== 'string' || !factor.id) return undefined
  const encrypted = input.sessionId ? factor.bcnPendingSecret : factor.secret
  if (
    typeof encrypted !== 'string' ||
    !encrypted ||
    (input.sessionId &&
      (factor.bcnPendingSessionId !== input.sessionId ||
        factor.bcnPendingGeneration !== input.expectedGeneration))
  )
    return undefined
  const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: encrypted })
  const otp = createOTP(secret, { digits: 6, period: 30 })
  const counter = Math.floor(Date.now() / 30_000)
  const matchingCounters: number[] = []
  for (const candidate of [counter - 1, counter, counter + 1]) {
    if (equalCode(code, await otp.hotp(candidate))) matchingCounters.push(candidate)
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(JSON.stringify(['bcn-totp-replay-v1', input.userId, code])),
  )
  const digest = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
  return {
    digest,
    userId: input.userId,
    factorId: factor.id,
    factorFingerprint: await fingerprintWorkforceFactor(encrypted),
    matchingCounters,
  }
}
