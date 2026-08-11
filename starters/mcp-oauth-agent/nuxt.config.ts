export default defineNuxtConfig({
  modules: ['better-convex-nuxt'],
  compatibilityDate: '2026-07-16',
  routeRules: {
    '/login': {
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': "frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      },
    },
    '/oauth/consent': {
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': "frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      },
    },
  },
  convex: {
    url: process.env.NUXT_PUBLIC_CONVEX_URL,
    siteUrl: process.env.NUXT_PUBLIC_CONVEX_SITE_URL,
    auth: {
      origin: process.env.SITE_URL ?? 'http://localhost:3000',
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
