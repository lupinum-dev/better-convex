import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const siteUrl = (process.env.SITE_URL || 'https://better-convex.lupinum.com').replace(/\/$/, '')

// Every docs page must ship as /raw/<route>.md and be listed in llms.txt: the agent docs
// in the published packages are built from them. Unpatched ginko-content keeps a random
// 100 pages (see the patch in pnpm-workspace.yaml), so check the output on every build.
function assertAgentMarkdown(rootDir: string, publicDir: string) {
  const expected = readdirSync(join(rootDir, 'content/docs'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const route = file
        .replace(/\.md$/, '')
        .split(/[\\/]/)
        .map((part) => part.replace(/^\d+\./, ''))
      return route.join('/') === 'index' ? '/raw/docs.md' : `/raw/docs/${route.join('/')}.md`
    })
  const llms = readFileSync(join(publicDir, 'llms.txt'), 'utf8')
  const missing = expected.filter(
    (route) => !existsSync(join(publicDir, route)) || !llms.includes(`${siteUrl}${route})`),
  )
  if (missing.length) {
    throw new Error(
      `${missing.length} of ${expected.length} docs pages are missing from .output/public/raw/ or llms.txt:\n${missing.join('\n')}`,
    )
  }
}

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
  hooks: {
    'nitro:init'(nitro) {
      nitro.hooks.hook('prerender:done', () =>
        assertAgentMarkdown(nitro.options.rootDir, nitro.options.output.publicDir),
      )
    },
  },
  compatibilityDate: '2025-07-15',
})
