import { symmetricEncrypt } from 'better-auth/crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { createAccountIdTokenProtector } from '../../src/runtime/convex-auth/adapter/create-adapter'

const sentinel = 'provider-id-token-sentinel.never.persist.raw'
const options = {
  account: { encryptOAuthTokens: true },
  secrets: [
    { version: 7, value: 'current-id-token-encryption-secret-32-bytes' },
    { version: 6, value: 'retained-id-token-encryption-secret-32-bytes' },
  ],
}

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRETS
  delete process.env.BETTER_AUTH_SECRET
  delete process.env.AUTH_SECRET
})

describe('provider ID-token storage protection', () => {
  it('encrypts at the adapter boundary and reveals only to the auth process', async () => {
    const protector = createAccountIdTokenProtector(options)
    const stored = (await protector.protect('account', {
      id: 'account-1',
      idToken: sentinel,
    })) as Record<string, unknown>

    expect(stored.idToken).toMatch(/^\$ba\$/u)
    expect(stored.idToken).not.toContain(sentinel)
    await expect(protector.reveal('account', stored)).resolves.toEqual({
      id: 'account-1',
      idToken: sentinel,
    })
  })

  it('rejects an unencrypted database value and missing secure profile', async () => {
    const protector = createAccountIdTokenProtector(options)
    await expect(protector.reveal('account', { idToken: sentinel })).rejects.toThrow(
      'AUTH_ID_TOKEN_AT_REST_UNENCRYPTED',
    )
    await expect(
      createAccountIdTokenProtector({
        ...options,
        account: { encryptOAuthTokens: false },
      }).protect('account', { idToken: sentinel }),
    ).rejects.toThrow('AUTH_OAUTH_TOKEN_ENCRYPTION_REQUIRED')
  })

  it('supports retained versioned keys and does not touch other models', async () => {
    const oldProtector = createAccountIdTokenProtector({
      ...options,
      secrets: [options.secrets[1]!],
    })
    const oldCiphertext = (await oldProtector.protect('account', {
      idToken: sentinel,
    })) as Record<string, unknown>
    const rotated = createAccountIdTokenProtector(options)

    await expect(rotated.reveal('account', oldCiphertext)).resolves.toEqual({ idToken: sentinel })
    await expect(rotated.protect('session', { idToken: sentinel })).resolves.toEqual({
      idToken: sentinel,
    })
  })

  it('never decrypts a legacy bare ciphertext through the finalized current secret', async () => {
    const currentSecret = options.secrets[0]!.value
    const legacyCiphertext = await symmetricEncrypt({ data: sentinel, key: currentSecret })
    const finalizedOptions = { ...options, secret: currentSecret }
    const protector = createAccountIdTokenProtector(finalizedOptions)

    expect(legacyCiphertext).not.toMatch(/^\$ba\$/u)
    await expect(protector.reveal('account', { idToken: legacyCiphertext })).rejects.toThrow(
      'AUTH_ID_TOKEN_AT_REST_UNENCRYPTED',
    )
  })

  it.each(['BETTER_AUTH_SECRET', 'AUTH_SECRET'] as const)(
    'rejects legacy %s even when versioned secrets are configured',
    (name) => {
      process.env.BETTER_AUTH_SECRETS =
        '9:environment-current-secret-at-least-32-bytes,8:environment-old-secret-at-least-32-bytes'
      process.env[name] = 'legacy-secret-must-never-be-used'

      expect(() =>
        createAccountIdTokenProtector({ account: { encryptOAuthTokens: true } }),
      ).toThrow('AUTH_LEGACY_SECRET_UNSUPPORTED')
    },
  )

  it('parses the same versioned environment format required by Better Auth', async () => {
    process.env.BETTER_AUTH_SECRETS =
      '9:environment-current-secret-at-least-32-bytes,8:environment-old-secret-at-least-32-bytes'
    const protector = createAccountIdTokenProtector({
      account: { encryptOAuthTokens: true },
    })
    const stored = (await protector.protect('account', { idToken: sentinel })) as Record<
      string,
      unknown
    >
    expect(stored.idToken).toMatch(/^\$ba\$/u)
    await expect(protector.reveal('account', stored)).resolves.toEqual({ idToken: sentinel })
  })
})
