import ConvexModule from '../../../src/module'

// Auth is omitted: a Convex-only build by default. The module must add no Better
// Auth client, auth engine, proxy handler, or auth middleware to the generated
// client/Nitro graphs. `scripts/check-auth-disabled-build-graph.mjs` builds this
// fixture and scans `.output` for markers unique to auth-enabled-only files.
export default defineNuxtConfig({
  modules: [ConvexModule],
  convex: {
    url: 'https://auth-disabled.convex.cloud',
    siteUrl: 'https://auth-disabled.convex.site',
  },
  nitro: {
    // Keep the Nitro build small and deterministic for the graph scan.
    preset: 'node-server',
  },
})
