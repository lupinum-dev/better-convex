import ConvexModule from '../../../src/module'

// Real Nuxt fixture app driving the library's SSR error path. `convex.url`
// points at a deterministic local
// HTTP mock (see ../../e2e/ssr-errors-consumer.e2e.test.ts) that always
// answers the query endpoint with a structured application failure whose wire
// message carries a sentinel. The real normalization boundary must make that
// message opaque while preserving structured application fields.
export default defineNuxtConfig({
  modules: [ConvexModule],
  ssr: true,
  telemetry: false,
  devtools: { enabled: false },
  vite: { server: { hmr: { port: 24699 } } },
  experimental: {
    payloadExtraction: true,
  },
  convex: {
    // Convex-only build: no Better Auth machinery, so an `optional`-mode
    // query never waits on auth settlement and the mocked HTTP boundary
    // failure surfaces as `server`, not `authentication`.
    auth: false,
    url: process.env.SSR_ERRORS_MOCK_CONVEX_URL || 'http://127.0.0.1:4988',
  },
})
