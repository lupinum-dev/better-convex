import { createAuthClient } from 'better-auth/vue'

import definition from './convex-auth'

const client = createAuthClient({
  baseURL: 'http://localhost:3000/api/auth',
  plugins: [...(definition.options.plugins ?? [])],
})

async function pluginContract() {
  await client.twoFactor.verifyTotp({ code: '123456', trustDevice: false })
  await client.twoFactor.verifyBackupCode({ code: 'backup-code', trustDevice: false })
  await client.emailOtp.sendVerificationOtp({ email: 'user@example.test', type: 'sign-in' })
  await client.signIn.emailOtp({ email: 'user@example.test', otp: '123456' })
  await client.signIn.popup({ providerId: 'local-oidc', callbackURL: '/' })
}

void pluginContract
