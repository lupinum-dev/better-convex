export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@lupinum/better-convex-nuxt'],
  convex: {
    auth: {
      origin: process.env.SITE_URL,
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
      // Where a protected page sends anonymous visitors, and where the sign-in page sends
      // people who are already signed in.
      redirectTo: '/',
      guestRedirectTo: '/todos',
    },
  },
})
