import { defineNuxtConfig } from 'nuxt/config'
const convexUrl = process.env.NUXT_PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL
const convexSiteUrl =
  process.env.NUXT_PUBLIC_CONVEX_SITE_URL ||
  process.env.CONVEX_SITE_URL ||
  process.env.VITE_CONVEX_SITE_URL

export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  pages: true,
  devtools: { enabled: true },
  compatibilityDate: '2026-06-23',
  typescript: {
    strict: true,
  },
  vite: {
    optimizeDeps: {
      // The browser verifier exercises first-load auth/codegen paths. Pre-bundling
      // these runtime deps prevents Vite's dependency discovery reload mid-flow.
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'better-auth/vue',
        'convex/browser',
        'convex/server',
        'convex/values',
        'zod',
      ],
    },
  },
  convex: {
    url: convexUrl,
    siteUrl: convexSiteUrl,
    auth: {
      origin: process.env.SITE_URL ?? 'http://localhost:3000',
      trustedClientIpHeader: process.env.BCN_AUTH_TRUSTED_CLIENT_IP_HEADER,
    },
  },
})
