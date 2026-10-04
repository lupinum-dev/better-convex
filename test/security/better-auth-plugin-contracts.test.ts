import { emailOTPClient, twoFactorClient } from 'better-auth/client/plugins'
import { describe, expect, it } from 'vitest'

describe('pinned Better Auth plugin session contracts', () => {
  it.each([
    [
      'every two-factor completion path',
      twoFactorClient(),
      [
        '/two-factor/verify-totp',
        '/two-factor/verify-otp',
        '/two-factor/verify-backup-code',
        '/two-factor/disable',
      ],
    ],
    [
      'email OTP sign-in and verification',
      emailOTPClient(),
      ['/sign-in/email-otp', '/email-otp/verify-email'],
    ],
  ])('signals the public session atom after %s', (_label, plugin, paths) => {
    for (const path of paths) {
      expect(
        plugin.atomListeners.some((listener) => listener.matcher(path)),
        path,
      ).toBe(true)
    }
    expect(plugin.atomListeners.every((listener) => listener.signal === '$sessionSignal')).toBe(
      true,
    )
  })
})
