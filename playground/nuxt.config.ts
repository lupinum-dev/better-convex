export default defineNuxtConfig({
  modules: ['../src/module'],

  pages: true,

  devtools: { enabled: true },

  // Keep the playground independent from Nuxt's globally shared default HMR
  // port so it can run alongside other local Nuxt applications and E2E apps.
  vite: {
    server: {
      hmr: { port: 24699 },
    },
  },

  compatibilityDate: '2026-02-26',

  routeRules: {},

  typescript: {
    strict: true,
  },

  convex: {
    url: process.env.NUXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL,
    siteUrl: process.env.NUXT_PUBLIC_CONVEX_SITE_URL ?? process.env.CONVEX_SITE_URL,
    auth: {
      // Required. The public origin of this site; .env.example sets it for local work.
      origin: process.env.SITE_URL,
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
