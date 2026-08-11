// Repository-only declaration for typechecking the auth-enabled runtime entry.
// Consumer builds receive the real virtual module only when `convex.auth` is
// configured. This file is outside the package `files` list and never ships.
declare module '#convex/auth-client' {
  const definition: import('../src/runtime/auth-client').ConvexAuthClientDefinition<
    import('../src/runtime/auth-client/definition-types').AuthClientPlugins
  >
  export default definition
}
