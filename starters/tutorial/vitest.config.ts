import { defineConfig } from 'vitest/config'

export default defineConfig({
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
    environment: 'node',
    include: ['convex/**/*.test.ts'],
  },
})
