export default {
  modules: ['@lupinum/better-convex-nuxt'],
  pages: true,
  devtools: { enabled: true },
  compatibilityDate: '2026-06-21',
  typescript: {
    strict: true,
  },
  convex: {
    auth: {
      // Required. The public origin of this site; .env.example sets it for local work.
      origin: process.env.SITE_URL,
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
}
