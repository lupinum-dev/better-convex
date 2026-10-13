export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
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
  vite: {
    optimizeDeps: {
      // Vite's first scan misses these imports of the auth client and of
      // ~~/convex/policy. Finding them on the first page load re-bundles every
      // dependency and reloads the page mid-sign-in.
      include: ['@better-auth/oauth-provider/client', '@lupinum/better-convex-functions/policy'],
    },
  },
  convex: {
    url: process.env.NUXT_PUBLIC_CONVEX_URL,
    siteUrl: process.env.NUXT_PUBLIC_CONVEX_SITE_URL,
    auth: {
      // Required. The public origin of this site; .env.example sets it for local work.
      origin: process.env.SITE_URL,
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
