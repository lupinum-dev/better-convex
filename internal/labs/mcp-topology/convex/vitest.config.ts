import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ['internal/labs/mcp-topology/convex/**/*.test.ts'],
    testTimeout: 120_000,
  },
})
