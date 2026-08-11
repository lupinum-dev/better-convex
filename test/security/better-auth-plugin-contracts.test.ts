import { emailOTPClient, oauthPopupClient, twoFactorClient } from 'better-auth/client/plugins'
import { describe, expect, it } from 'vitest'

describe('pinned Better Auth plugin session contracts', () => {
  it('signals the public session atom after every two-factor completion path', () => {
    const plugin = twoFactorClient()
    const paths = [
      '/two-factor/verify-totp',
      '/two-factor/verify-otp',
      '/two-factor/verify-backup-code',
      '/two-factor/disable',
    ]
    for (const path of paths) {
      expect(plugin.atomListeners.some((listener) => listener.matcher(path))).toBe(true)
      expect(plugin.atomListeners.every((listener) => listener.signal === '$sessionSignal')).toBe(
        true,
      )
    }
  })

  it('signals the public session atom after email OTP sign-in and verification', () => {
    const plugin = emailOTPClient()
    for (const path of ['/sign-in/email-otp', '/email-otp/verify-email']) {
      expect(plugin.atomListeners.some((listener) => listener.matcher(path))).toBe(true)
      expect(plugin.atomListeners.every((listener) => listener.signal === '$sessionSignal')).toBe(
        true,
      )
    }
  })

  it('retains the OAuth popup client plugin identity used by the typed fixture', () => {
    expect(oauthPopupClient().id).toBe('oauth-popup')
  })
})
