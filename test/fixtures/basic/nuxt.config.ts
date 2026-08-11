import ConvexModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [ConvexModule],
  vite: { server: { hmr: { port: 24699 } } },
  convex: {
    url: 'https://test-convex.convex.cloud',
    siteUrl: 'http://localhost:3000',
    auth: { origin: process.env.SITE_URL ?? 'http://localhost:3000' },
  },
})
