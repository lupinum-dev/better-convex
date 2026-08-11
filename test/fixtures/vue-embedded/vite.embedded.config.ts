import { defineConfig } from 'vite'

export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: {
      entry: 'src/embedded.ts',
      formats: ['es'],
      fileName: () => 'embedded.mjs',
    },
    minify: true,
    outDir: 'dist-embedded',
  },
})
