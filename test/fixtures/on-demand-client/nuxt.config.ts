import ConvexModule from '../../../src/module'

// Real Nuxt fixture for `client.connect: 'on-demand'` and route-level SSR auth
// (see ../../e2e/on-demand-client.e2e.test.ts). A local HTTP mock stands in for
// both the Convex deployment and its site URL and records every request.
const mockOrigin = process.env.ON_DEMAND_MOCK_ORIGIN || 'http://127.0.0.1:4989'

export default defineNuxtConfig({
  modules: [ConvexModule],
  ssr: true,
  telemetry: false,
  devtools: { enabled: false },
  vite: { server: { hmr: { port: 24698 } } },
  convex: {
    url: mockOrigin,
    siteUrl: mockOrigin,
    client: { connect: 'on-demand', skipConvexDeploymentUrlCheck: true },
    auth: {
      origin: process.env.ON_DEMAND_SITE_ORIGIN || 'http://127.0.0.1:4612',
      redirectTo: '/sign-in',
    },
  },
  routeRules: {
    '/': { convex: { ssrAuth: false } },
  },
})
