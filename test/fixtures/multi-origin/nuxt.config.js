export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  compatibilityDate: '2026-07-16',
  devtools: { enabled: false },
  vite: { server: { hmr: false } },
  convex: {
    url: process.env.NUXT_PUBLIC_CONVEX_URL,
    siteUrl: process.env.NUXT_PUBLIC_CONVEX_SITE_URL,
    auth: { origin: process.env.SITE_URL },
  },
})
