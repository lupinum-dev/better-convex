import { fileURLToPath } from 'node:url'

import { defineVitestProject } from '@nuxt/test-utils/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Keep package subpaths before the root alias; integration and E2E use the build.
const vueSourceAliases = {
  '@lupinum/better-convex-vue/internal': fileURLToPath(
    new URL('./packages/vue/src/internal.ts', import.meta.url),
  ),
  '@lupinum/better-convex-vue/test': fileURLToPath(
    new URL('./packages/vue/src/test.ts', import.meta.url),
  ),
  '@lupinum/better-convex-vue/errors': fileURLToPath(
    new URL('./packages/vue/src/errors.ts', import.meta.url),
  ),
  '@lupinum/better-convex-vue/embedded': fileURLToPath(
    new URL('./packages/vue/src/embedded.ts', import.meta.url),
  ),
  '@lupinum/better-convex-vue/experimental': fileURLToPath(
    new URL('./packages/vue/src/experimental.ts', import.meta.url),
  ),
  '@lupinum/better-convex-vue': fileURLToPath(
    new URL('./packages/vue/src/index.ts', import.meta.url),
  ),
}

// The agents package and the functions package it builds on, from source. Subpath entries must
// precede the root entry they extend.
const agentsSourceAliases = {
  '@lupinum/better-convex-functions/internal': fileURLToPath(
    new URL('./packages/functions/src/internal.ts', import.meta.url),
  ),
  '@lupinum/better-convex-functions/test': fileURLToPath(
    new URL('./packages/functions/src/test.ts', import.meta.url),
  ),
  '@lupinum/better-convex-functions': fileURLToPath(
    new URL('./packages/functions/src/index.ts', import.meta.url),
  ),
  '@lupinum/better-convex-agents/internal': fileURLToPath(
    new URL('./packages/agents/src/internal.ts', import.meta.url),
  ),
  '@lupinum/better-convex-agents/mcp': fileURLToPath(
    new URL('./packages/agents/src/mcp.ts', import.meta.url),
  ),
  '@lupinum/better-convex-agents/test': fileURLToPath(
    new URL('./packages/agents/src/test.ts', import.meta.url),
  ),
  '@lupinum/better-convex-agents': fileURLToPath(
    new URL('./packages/agents/src/index.ts', import.meta.url),
  ),
}

/**
 * Vitest projects
 *
 *   pnpm test              unit, security, convex, nuxt, browser, auth-adapter, auth-fuzz, mcp, functions, agents
 *   pnpm test:integration  real local Convex backend suites (test/integration)
 *   pnpm test:e2e          full-stack Nuxt suites (scripts/run-e2e.mjs, --full adds extended/)
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
            ...vueSourceAliases,
            ...agentsSourceAliases,
            '#app': fileURLToPath(new URL('./test/unit/shims/app.ts', import.meta.url)),
          },
        },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          // Runs in the edge-runtime auth-adapter project.
          exclude: ['test/unit/convex-auth-adapter-invariants.test.ts'],
          environment: 'node',
        },
      },

      // The shared adapter's pure model and its convex-test backend contract.
      {
        resolve: {
          alias: {
            ...vueSourceAliases,
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

      // Deterministic bounded protocol-input corpora. A failing case reports
      // and persists its exact replay seed outside the repository.
      {
        resolve: { alias: vueSourceAliases },
        test: {
          name: 'auth-fuzz',
          include: ['test/auth-fuzz/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },

      // MCP package, starter and documentation-sample contracts. The real
      // client journey runs in the integration project. The starter's own tests
      // run here from source, and in `pnpm test:starters` against the packed packages.
      {
        resolve: {
          alias: {
            ...vueSourceAliases,
            '@lupinum/better-convex-nuxt/better-auth/server': fileURLToPath(
              new URL('./src/runtime/convex-auth/index.ts', import.meta.url),
            ),
            '@lupinum/better-convex-nuxt/better-auth/test': fileURLToPath(
              new URL('./src/runtime/convex-auth/test.ts', import.meta.url),
            ),
            ...agentsSourceAliases,
          },
        },
        test: {
          name: 'mcp',
          include: ['test/mcp/**/*.test.ts', 'starters/mcp-oauth-agent/convex/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },

      // Functions package: row rules, policy, no-bypass, budgets and type tests against its
      // fixture apps (packages/functions/test). convex-test runs here as in the skeleton.
      {
        resolve: {
          alias: {
            // The subpath entry must precede the root entry it extends.
            '@lupinum/better-convex-functions/test': fileURLToPath(
              new URL('./packages/functions/src/test.ts', import.meta.url),
            ),
            '@lupinum/better-convex-functions': fileURLToPath(
              new URL('./packages/functions/src/index.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'functions',
          include: ['packages/functions/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },

      // Agents package: tools, approvals, limits, activity and the MCP door against its fixture apps
      // (packages/agents/test), through convex-test's HTTP router with the real MCP SDK.
      {
        resolve: { alias: agentsSourceAliases },
        test: {
          name: 'agents',
          include: ['packages/agents/test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          // Approval links need it; nothing is called.
          env: { SITE_URL: 'https://placeholder.example' },
        },
      },

      // Security regressions, including the OAuth provider and resource-server suites.
      {
        resolve: {
          alias: {
            ...vueSourceAliases,
            ...agentsSourceAliases,
            '#app': fileURLToPath(new URL('./test/unit/shims/app.ts', import.meta.url)),
          },
        },
        test: {
          name: 'security',
          include: ['test/security/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },

      // Convex Tests: Backend function tests
      // Uses convex-test with edge-runtime
      // Fast (~5s) - run with `pnpm test`
      {
        resolve: {
          alias: {
            ...vueSourceAliases,
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
          exclude: ['playground/convex/auth-adapter-invariants.test.ts'],
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
        resolve: { alias: vueSourceAliases },
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              rootDir: fileURLToPath(new URL('.', import.meta.url)),
              overrides: { alias: vueSourceAliases },
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
            ...vueSourceAliases,
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

      // Real local Convex backend: OAuth/MCP journeys, auth concurrency,
      // credentials at rest and the beta.7 upgrade. The global setup builds the
      // packages the suites install and verifies the pinned backend binary.
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.integration.test.ts'],
          environment: 'node',
          globalSetup: ['test/integration/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 600_000,
          hookTimeout: 600_000,
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
