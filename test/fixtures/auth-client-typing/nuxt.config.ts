// Packed typed-client release gate (packed contract fixture). Installs the
// packed `@lupinum/better-convex-nuxt` tarball so the module and this consumer share a
// SINGLE `better-auth` copy — a linked fixture would resolve two copies and
// wrongly reject the plugin tuple. `convex-auth.ts` (with `organizationClient()`) is
// discovered by the `<srcDir>/convex-auth.ts` convention, so `nuxi prepare`
// generates the REAL registry declaration that types the client.
export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  convex: {
    url: 'https://auth-client-typing.convex.cloud',
    siteUrl: 'https://auth-client-typing.convex.site',
    auth: {
      origin: process.env.SITE_URL ?? 'https://auth-client-typing.example.test',
      trustedClientIpHeader: 'x-test-client-ip',
    },
  },
  typescript: {
    // The base-fallback assertions are a SEPARATE TypeScript program (its own
    // tsconfig); two conflicting registries
    // cannot coexist in one program — so exclude it from the app typecheck.
    tsConfig: {
      exclude: ['../base-fallback'],
    },
  },
})
