import { createOTP } from '@better-auth/utils/otp'
import { betterAuth } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { createAuthEndpoint } from 'better-auth/api'
import { symmetricEncrypt } from 'better-auth/crypto'
import { twoFactor } from 'better-auth/plugins'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { bindWorkforceTotpReplay } from '../../src/runtime/convex-auth/workforce/otp-binding'
import {
  workforceSchemaOptions,
  workforceSchemaPlugin,
} from '../../src/runtime/convex-auth/workforce/schema'

const seed = 'synthetic fixed workforce TOTP seed'
const now = 1_800_000_000_000

afterEach(() => vi.restoreAllMocks())

async function fixture() {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const db: MemoryDB = { user: [], account: [], session: [], verification: [], twoFactor: [] }
  const input: { userId: string; expectedGeneration: number; sessionId?: string } = {
    userId: 'synthetic-user',
    expectedGeneration: 0,
  }
  const auth = betterAuth({
    baseURL: 'https://otp-binding.example.test',
    secret: 'synthetic-otp-binding-secret-longer-than-thirty-two-characters',
    logger: { disabled: true },
    database: memoryAdapter(db),
    ...workforceSchemaOptions,
    plugins: [
      twoFactor(),
      workforceSchemaPlugin,
      {
        id: 'synthetic-replay-binding-test',
        endpoints: {
          syntheticReplay: createAuthEndpoint(
            '/synthetic-replay',
            {
              method: 'POST',
              body: z.object({ code: z.unknown(), replay: z.unknown().optional() }),
            },
            async (ctx) => ({ proof: (await bindWorkforceTotpReplay(ctx, input)) ?? null }),
          ),
        },
      },
    ],
  })
  const context = await auth.$context
  const factor: Record<string, unknown> = {
    id: 'synthetic-factor',
    userId: input.userId,
    secret: await symmetricEncrypt({ key: context.secretConfig, data: seed }),
    backupCodes: 'unused-in-this-binding-test',
    verified: true,
  }
  db.twoFactor!.push(factor)
  const code = await createOTP(seed).totp()
  async function proof() {
    const result = await auth.api.syntheticReplay({ body: { code } })
    if (!result.proof) throw new Error('SYNTHETIC_REPLAY_PROOF_REQUIRED')
    return result.proof
  }
  return { auth, context, factor, input, code, proof }
}

describe('owned workforce OTP evidence binding', () => {
  it('keeps the digest stable across factor rows, generations, and ciphertext re-encryption', async () => {
    const h = await fixture()
    const first = await h.proof()
    h.factor.id = 'replacement-factor-row'
    h.input.expectedGeneration = 8
    h.factor.secret = await symmetricEncrypt({ key: h.context.secretConfig, data: seed })
    const second = await h.proof()
    expect(second.digest).toBe(first.digest)
    expect(second.factorId).not.toBe(first.factorId)
    expect(second.factorFingerprint).not.toBe(first.factorFingerprint)
    expect(second.matchingCounters).toContain(Math.floor(now / 30_000))
  })

  it('separates the same numeric code under a new seed or another user', async () => {
    const h = await fixture()
    const first = await h.proof()
    h.factor.secret = await symmetricEncrypt({
      key: h.context.secretConfig,
      data: 'another synthetic TOTP seed',
    })
    expect((await h.proof()).digest).not.toBe(first.digest)
    h.factor.secret = await symmetricEncrypt({ key: h.context.secretConfig, data: seed })
    h.input.userId = 'another-user'
    h.factor.userId = h.input.userId
    expect((await h.proof()).digest).not.toBe(first.digest)
  })

  it('ignores caller replay metadata and never includes clear code or seed', async () => {
    const h = await fixture()
    const expected = await h.proof()
    const supplied = await h.auth.api.syntheticReplay({
      body: { code: h.code, replay: { digest: 'attacker', matchingCounters: [0], secret: seed } },
    })
    expect(supplied.proof).toEqual(expected)
    expect(Object.keys(expected).sort()).toEqual([
      'digest',
      'factorFingerprint',
      'factorId',
      'matchingCounters',
      'userId',
    ])
    expect(JSON.stringify(expected)).not.toContain(seed)
    expect(JSON.stringify(expected)).not.toContain(h.code)
  })

  it.each([
    {},
    { bcnPendingSecret: null },
    { bcnPendingSessionId: 'another-session' },
    { bcnPendingGeneration: 1 },
  ])('fails closed for missing or mismatched pending binding: %j', async (patch) => {
    const h = await fixture()
    h.input.sessionId = 'enrollment-session'
    if (Object.keys(patch).length > 0) {
      Object.assign(
        h.factor,
        {
          bcnPendingSecret: h.factor.secret,
          bcnPendingSessionId: h.input.sessionId,
          bcnPendingGeneration: 0,
        },
        patch,
      )
    }
    expect((await h.auth.api.syntheticReplay({ body: { code: h.code } })).proof).toBeNull()
  })

  it('binds the designated pending seed and preserves its identity across sessions', async () => {
    const h = await fixture()
    const active = await h.proof()
    h.input.sessionId = 'enrollment-session'
    Object.assign(h.factor, {
      bcnPendingSecret: h.factor.secret,
      bcnPendingSessionId: h.input.sessionId,
      bcnPendingGeneration: 0,
    })
    expect((await h.proof()).digest).toBe(active.digest)
    h.input.sessionId = 'successor-session'
    h.factor.bcnPendingSessionId = h.input.sessionId
    expect((await h.proof()).digest).toBe(active.digest)
  })

  it.each(['12345', '1234567', 'abcdef', 123456, null])(
    'leaves malformed code %j to provider validation without creating evidence',
    async (code) => {
      const h = await fixture()
      expect((await h.auth.api.syntheticReplay({ body: { code } })).proof).toBeNull()
    },
  )
})
