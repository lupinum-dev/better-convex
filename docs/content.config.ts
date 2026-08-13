import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

const siteUrl = (process.env.SITE_URL || 'https://better-convex.lupinum.com').replace(/\/$/, '')

export default defineGinkoDocsConfig({
  site: {
    name: 'Better Convex',
    description:
      'Convex for Nuxt 4 with SSR-to-realtime queries, Better Auth, typed server calls, optimistic updates, and uploads.',
    url: siteUrl,
  },
  locales: ['en'],
  blog: false,
})
