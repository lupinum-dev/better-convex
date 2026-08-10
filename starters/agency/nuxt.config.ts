export default {
  modules: ['better-convex-nuxt'],
  pages: true,
  devtools: { enabled: true },
  compatibilityDate: '2026-06-21',
  typescript: {
    strict: true,
  },
  convex: {
    auth: {
      origin: process.env.SITE_URL ?? 'http://localhost:3000',
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
}
