// Packed `/server` subpath consumer. Typechecking proves the published entry
// resolves from the installed tarball rather than an in-app alias.
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  convex: {
    url: process.env.SERVER_CONSUMER_CONVEX_URL ?? 'https://server-consumer.convex.cloud',
    siteUrl: process.env.SERVER_CONSUMER_CONVEX_SITE_URL ?? 'https://server-consumer.convex.site',
    auth: {
      origin: process.env.SITE_URL ?? 'https://server-consumer.example.test',
      trustedClientIpHeader: 'x-test-client-ip',
    },
  },
})
