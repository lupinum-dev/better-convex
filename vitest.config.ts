import { fileURLToPath } from 'node:url'

import { defineVitestProject } from '@nuxt/test-utils/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Vitest Configuration
 *
 * Test commands:
 *   pnpm test       - CI/local gate (unit + convex + nuxt + browser)
 *   pnpm test:e2e   - Full-stack tests used locally and by release:verify
 *
 * Supported focused commands:
 *   pnpm test:auth-adapter
 *   pnpm test:oauth
 *   pnpm test:nuxt
 *   pnpm test:e2e
 *
 * Prepare generated root types before an ad hoc project command:
 *   pnpm exec nuxt-module-build prepare
 *   pnpm exec vitest run --project=convex
 */
export default defineConfig({
  test: {
    // Default timeout for all tests
    testTimeout: 10000,

    // Use projects for different test types
    projects: [
      // Unit Tests: Pure utility function tests
      // Fast (<1s). Use the prepared `pnpm test` gate, or prepare generated
      // root types before invoking this project directly.
      {
        resolve: {
          alias: {
            '#app': fileURLToPath(new URL('./test/unit/shims/app.ts', import.meta.url)),
          },
        },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },

      // Release-control tests invoke real package builds, mutate dist, or pack
      // artifacts. They share those outputs, so parallel execution is unsafe.
      {
        test: {
          name: 'release-control',
          include: ['test/release-control/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 240_000,
        },
      },

      // The shared adapter's pure model and its convex-test backend contract.
      {
        resolve: {
          alias: {
            '@lupinum/better-convex-nuxt/better-auth/test': fileURLToPath(
              new URL('./src/runtime/convex-auth/test.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'auth-adapter',
          include: [
            'test/unit/convex-auth-adapter-invariants.test.ts',
            'playground/convex/auth-adapter-invariants.test.ts',
          ],
          environment: 'edge-runtime',
          server: { deps: { inline: [/convex/] } },
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },

      // OAuth protocol and resource-server invariants. Real-client evidence is
      // exercised by the MCP auth runner against the same canonical routes.
      {
        test: {
          name: 'oauth',
          include: [
            'test/security/convex-auth-oauth-provider-integration.test.ts',
            'test/security/convex-auth-oauth-resource.test.ts',
            'test/security/convex-auth-oauth-security.test.ts',
          ],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },

      // Deterministic bounded protocol-input corpora. A failing case reports
      // and persists its exact replay seed outside the repository.
      {
        test: {
          name: 'auth-fuzz',
          include: ['test/auth-fuzz/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },

      // MCP resource/proxy/runner contracts. Real client and conformance
      // evidence is orchestrated by the two root MCP runners.
      {
        resolve: {
          alias: {
            '@lupinum/better-convex-nuxt/better-auth/server': fileURLToPath(
              new URL('./src/runtime/convex-auth/index.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'mcp',
          include: ['test/mcp/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },

      // Closed Section 9.6 raw-secret location registry, scanner negative
      // controls, and pinned-engine runtime evidence. Artifact scanning is
      // orchestrated by scripts/run-auth-sentinels.mjs in the same gate.
      {
        test: {
          name: 'auth-sentinels',
          include: ['test/security/auth-secret-sentinels.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },

      // Security regression tests are a mandatory release gate.
      {
        resolve: {
          alias: {
            '#app': fileURLToPath(new URL('./test/unit/shims/app.ts', import.meta.url)),
          },
        },
        test: {
          name: 'security',
          include: ['test/security/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },

      // Convex Tests: Backend function tests
      // Uses convex-test with edge-runtime
      // Fast (~5s) - run with `pnpm test`
      {
        resolve: {
          alias: {
            '@lupinum/better-convex-nuxt/better-auth/test': fileURLToPath(
              new URL('./src/runtime/convex-auth/test.ts', import.meta.url),
            ),
            '@lupinum/better-convex-nuxt/better-auth/server': fileURLToPath(
              new URL('./src/runtime/convex-auth/index.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'convex',
          include: [
            'playground/convex/**/*.test.ts',
            'demo/convex/**/*.test.ts',
            'test/convex/**/*.test.ts',
          ],
          environment: 'edge-runtime',
          server: { deps: { inline: [/convex/] } },
          // Convex component registration is CPU-heavy and parallel files contend
          // for the same worker resources. Run this backend corpus serially and
          // retain a finite bound that also works on a busy contributor machine.
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },

      // Nuxt Runtime Tests: composables/components needing nuxtApp context
      // Fast-medium (~seconds) - run with `pnpm test:nuxt`.
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              rootDir: fileURLToPath(new URL('.', import.meta.url)),
            },
          },
        },
      }),

      // Browser Component Tests: native browser rendering for Vue components
      {
        plugins: [vue()],
        optimizeDeps: {
          include: ['convex/values', 'vue'],
        },
        resolve: {
          alias: {
            '#imports': fileURLToPath(new URL('./test/browser/shims/imports.ts', import.meta.url)),
          },
        },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            headless: true,
          },
        },
      },

      // E2E Tests: SSR + Browser behavior tests
      // Uses @nuxt/test-utils for full Nuxt lifecycle
      // Serial to avoid port collisions
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          testTimeout: 60000,
          fileParallelism: false,
        },
      },
    ],
  },
})
