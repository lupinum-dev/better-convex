import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '~~': rootDir,
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        types: ['vite/client'],
      },
    },
  },
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
    testTimeout: 15_000,
  },
})
