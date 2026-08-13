const config = {
  ssr: false,
  srcDir: '.',
  buildDir: '../../../../node_modules/.cache/nuxt/devtools-ui',
  // Nuxt otherwise generates a UUID for every static build, making the
  // package tarball differ even when its source and dependencies are equal.
  buildId: 'better-convex-nuxt-devtools',
  devtools: { enabled: false },

  app: {
    baseURL: '/__convex_devtools__',
    head: {
      title: 'Convex DevTools',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      ],
    },
  },

  css: ['~/assets/styles.css'],

  typescript: {
    strict: true,
  },

  build: {
    transpile: [],
  },

  nitro: {
    preset: 'static',
    output: {
      dir: '../../../../node_modules/.cache/nuxt/devtools-output',
      publicDir: './dist',
    },
  },

  compatibilityDate: '2025-01-01' as const,
}

export default defineNuxtConfig(config)
