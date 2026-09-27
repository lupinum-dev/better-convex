const siteUrl = (process.env.SITE_URL || 'https://better-convex.lupinum.com').replace(/\/$/, '')

export default defineNuxtConfig({
  extends: ['@lupinum/ginko-docs'],
  modules: ['@nuxt/eslint'],
  site: { url: siteUrl },
  i18n: {
    baseUrl: siteUrl,
    locales: [{ code: 'en', language: 'en-US', name: 'English' }],
  },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Better Convex',
      meta: [
        {
          name: 'description',
          content:
            'Convex for Nuxt 4 with SSR-to-realtime queries, Better Auth, typed server calls, optimistic updates, and uploads.',
        },
      ],
    },
  },
  routeRules: {
    '/docs/guide/get-started': { redirect: '/docs/get-started/choose-your-path' },
    '/docs/guide/basics': { redirect: '/docs/get-started/first-realtime-page' },
    '/docs/guide/auth': { redirect: '/docs/get-started/add-authentication' },
    '/docs/guide/concepts': { redirect: '/docs/concepts/mental-model' },
    '/docs/data-fetching/queries': { redirect: '/docs/build/queries/queries' },
    '/docs/data-fetching/pagination': { redirect: '/docs/build/queries/pagination' },
    '/docs/data-fetching/caching-reuse': {
      redirect: '/docs/concepts/query-ownership-and-caching',
    },
    '/docs/mutations/mutations': { redirect: '/docs/build/write-data/mutations' },
    '/docs/mutations/actions': { redirect: '/docs/build/write-data/actions' },
    '/docs/mutations/optimistic-updates': { redirect: '/docs/build/write-data/optimistic-updates' },
    '/docs/auth-security/authentication': { redirect: '/docs/build/authentication/overview' },
    '/docs/server-side/server-routes': { redirect: '/docs/build/server/server-routes' },
    '/docs/server-side/ssr-hydration': { redirect: '/docs/concepts/ssr-hydration-realtime' },
    '/docs/advanced/connection-state': {
      redirect: '/docs/build/application-behavior/connection-state',
    },
    '/docs/advanced/error-handling': {
      redirect: '/docs/build/application-behavior/error-handling',
    },
    '/docs/advanced/file-storage': { redirect: '/docs/build/files/upload-files' },
    '/docs/advanced/logging': { redirect: '/docs/build/application-behavior/logging' },
    '/docs/advanced/module-config': { redirect: '/docs/reference/module-configuration' },
    '/docs/advanced/api-surface': { redirect: '/docs/reference/api-surface' },
    '/docs/overview/why-better-convex-nuxt': { redirect: '/docs/overview/introduction' },
    '/docs/overview/use-cases': { redirect: '/docs/overview/who-it-is-for' },
    '/docs/understand': { redirect: '/docs/concepts/mental-model' },
    '/docs/understand/mental-model': { redirect: '/docs/concepts/mental-model' },
    '/docs/understand/request-lifecycle': { redirect: '/docs/concepts/request-lifecycle' },
    '/docs/understand/ssr-hydration-realtime': {
      redirect: '/docs/concepts/ssr-hydration-realtime',
    },
    '/docs/understand/query-ownership-and-caching': {
      redirect: '/docs/concepts/query-ownership-and-caching',
    },
    '/docs/understand/authentication-and-identity': {
      redirect: '/docs/concepts/authentication-and-identity',
    },
    '/docs/understand/server-and-client-boundaries': {
      redirect: '/docs/concepts/server-and-client-boundaries',
    },
    '/docs/understand/errors-and-failures': { redirect: '/docs/concepts/errors-and-failures' },
    '/docs/understand/design-decisions': { redirect: '/docs/concepts/design-decisions' },
    '/docs/understand/glossary': { redirect: '/docs/concepts/glossary' },
  },
  compatibilityDate: '2025-07-15',
})
