import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Real consumers (and CI, which installs a packed tarball) resolve
// `@lupinum/better-convex-nuxt` from node_modules. The linked local fixture has no such
// entry, so it needs the bare specifier mapped to the package's types entry.
//
// Only apply that override when the node_modules copy is absent. When it is
// present, forcing the specifier to the repo's dist would mix declarations from
// two physical package copies. Paths are relative to the generated
// .nuxt/tsconfig.json; Nuxt merges this into its own.
const hasInstalledModule = existsSync(
  fileURLToPath(new URL('./node_modules/@lupinum/better-convex-nuxt', import.meta.url)),
)

export default defineNuxtConfig({
  modules: ['@lupinum/better-convex-nuxt'],
  convex: {
    url: 'https://consumer-smoke.convex.cloud',
    siteUrl: 'https://consumer-smoke.convex.site',
    auth: {
      origin: process.env.SITE_URL ?? 'https://consumer-smoke.example.test',
      trustedClientIpHeader: 'x-test-client-ip',
    },
  },
  ...(hasInstalledModule
    ? {}
    : {
        typescript: {
          tsConfig: {
            compilerOptions: {
              paths: {
                '@lupinum/better-convex-nuxt': ['../../../../dist/types.d.mts'],
                // The published `./auth-client` subpath (imported by the API
                // surface contract) has no node_modules copy in the linked
                // fixture, so map it to the built entry. Installed CI resolves it
                // through the package `exports` map instead.
                '@lupinum/better-convex-nuxt/better-auth/client': [
                  '../../../../dist/runtime/auth-client/index.d.ts',
                ],
              },
            },
          },
        },
      }),
})
