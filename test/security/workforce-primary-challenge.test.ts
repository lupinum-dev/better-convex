import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory'
import { createAuthMiddleware } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { expect, it } from 'vitest'

import type { WorkforceOperation } from '../../src/runtime/convex-auth/workforce/operations'
import {
  reserveWorkforcePasswordChallenge,
  setWorkforceOperation,
} from '../../src/runtime/convex-auth/workforce/request-context'
import { workforceSchemaOptions } from '../../src/runtime/convex-auth/workforce/schema'

it('reserves only the primary in the real pinned two-factor sign-in sequence for user ID zero', async () => {
  const database: MemoryDB = { user: [], account: [], session: [], verification: [], twoFactor: [] }
  const base = memoryAdapter(database)
  const reservations: Array<WorkforceOperation | null> = []
  const values: unknown[] = []
  const auth = betterAuth({
    baseURL: 'https://primary-proof.example.test',
    secret: 'synthetic-primary-proof-secret-longer-than-32-characters',
    logger: { disabled: true },
    ...workforceSchemaOptions,
    verification: { ...workforceSchemaOptions.verification, storeIdentifier: 'hashed' },
    database: (options: BetterAuthOptions): ReturnType<typeof base> => {
      const adapter = base(options)
      return {
        ...adapter,
        create: async <T extends Record<string, unknown>, R = T>(input: {
          model: string
          data: Omit<T, 'id'>
          select?: string[]
          forceAllowId?: boolean
        }): Promise<R> => {
          const created = await adapter.create<T, R>(input)
          if (input.model === 'verification') {
            if (
              !created ||
              typeof created !== 'object' ||
              !('id' in created) ||
              !('value' in created)
            )
              throw new Error('SYNTHETIC_PRIMARY_PROOF_ROW_REQUIRED')
            values.push(input.data.value)
            // This outer memory wrapper receives no ID until normalization.
            // It proves provider ordering; the owned-adapter transport tests
            // separately prove reservation before the component mutation.
            reservations.push(await reserveWorkforcePasswordChallenge(created))
          }
          return created
        },
      }
    },
    emailAndPassword: { enabled: true, autoSignIn: false },
    databaseHooks: {
      user: { create: { before: async (user) => ({ data: { ...user, id: '0' } }) } },
    },
    plugins: [twoFactor()],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email') {
          await setWorkforceOperation({
            operation: 'password-sign-in',
            userId: '0',
            expectedGeneration: 0,
          })
        }
      }),
    },
  })
  const email = 'zero@example.test'
  const password = 'synthetic primary challenge password'
  const signedUp = await auth.api.signUpEmail({ body: { name: 'Zero', email, password } })
  expect(signedUp.user.id).toBe('0')
  const context = await auth.$context
  await context.adapter.update({
    model: 'user',
    where: [{ field: 'id', value: '0' }],
    update: { twoFactorEnabled: true },
  })
  // Sign-in only checks factor presence here; this test does not verify a TOTP
  // or claim that a challenge reservation constitutes successful MFA.
  await context.adapter.create({
    model: 'twoFactor',
    data: {
      userId: '0',
      secret: 'synthetic-unused-ciphertext',
      backupCodes: 'synthetic-unused-codes',
      verified: true,
    },
  })
  const response = await auth.api.signInEmail({ body: { email, password } })
  expect(response).toMatchObject({ twoFactorRedirect: true })
  expect(values).toEqual(['0', '0'])
  expect(reservations).toEqual([
    {
      operation: 'password-challenge',
      userId: '0',
      expectedGeneration: 0,
      challengeId: expect.any(String),
    },
    null,
  ])
})
