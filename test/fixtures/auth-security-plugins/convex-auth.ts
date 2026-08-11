import { emailOTPClient, oauthPopupClient, twoFactorClient } from 'better-auth/client/plugins'

import { defineConvexAuthClient } from '../../../src/runtime/auth-client'

export default defineConvexAuthClient({
  plugins: [
    twoFactorClient({ twoFactorPage: '/auth/two-factor' }),
    emailOTPClient(),
    oauthPopupClient(),
  ],
})
