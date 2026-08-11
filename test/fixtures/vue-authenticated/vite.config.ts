import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'convex/browser': fileURLToPath(
        new URL('../browser-runtime/mock-convex-browser.ts', import.meta.url),
      ),
    },
  },
})
