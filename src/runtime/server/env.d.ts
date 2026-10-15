// Ambient types for `tsc -p src/runtime/server/tsconfig.json`. Its `include`
// replaces the one of Nuxt's generated server tsconfig, so Node globals
// (`process`, `Buffer`) and `import.meta.dev` would otherwise be untyped on
// Nuxt 5, whose server tsconfig sets `types: []`. `dev` is optional and
// writable, the same declaration as nitropack 2 and Nitro 3, so the two merge.
/// <reference types="node" />

interface ImportMeta {
  dev?: boolean
}
