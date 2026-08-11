import { defineConfig } from 'vite'

export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: {
      entry: 'src/host.ts',
      formats: ['es'],
      fileName: () => 'host.mjs',
    },
    minify: true,
    outDir: 'dist-host',
  },
})
