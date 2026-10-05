// Repository-only declaration for `#convex/client-activation`, which
// `src/module.ts` generates per build. This file never ships.
declare module '#convex/client-activation' {
  export const connect: 'eager' | 'on-demand'
  export const loadBrowserRuntime: (() => Promise<(nuxtApp: import('#app').NuxtApp) => void>) | null
}
