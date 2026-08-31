import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

export default defineGinkoDocsConfig({
  site: {
    name: 'Better Convex',
    description:
      'Convex for Nuxt 4 with SSR-to-realtime queries, Better Auth, typed server calls, optimistic updates, and uploads.',
    whenToUse: 'Use this site to build and operate Convex applications with Nuxt or Vue.',
  },
  locales: ['en'],
  blog: false,
})
