export interface ModuleImportRegistration {
  name: string
  from: string
}

export const composableAutoImports = [
  { name: 'useConvex', from: './runtime/composables/useConvex' },
  { name: 'useConvexActivation', from: './runtime/composables/useConvexActivation' },
  {
    name: 'useConvexAttachment',
    from: './runtime/composables/useConvexAttachment',
  },
  { name: 'useConvexConfig', from: './runtime/composables/useConvexConfig' },
  {
    name: 'useConvexMutation',
    from: './runtime/composables/useConvexMutation',
  },
  { name: 'useConvexForm', from: './runtime/composables/useConvexForm' },
  { name: 'useConvexAction', from: './runtime/composables/useConvexAction' },
  { name: 'useConvexQuery', from: './runtime/composables/useConvexQuery' },
  {
    name: 'useConvexPaginatedQuery',
    from: './runtime/composables/useConvexPaginatedQuery',
  },
  {
    name: 'useConvexConnectionState',
    from: './runtime/composables/useConvexConnectionState',
  },
  {
    name: 'useConvexFileUpload',
    from: './runtime/composables/useConvexFileUpload',
  },
] as const satisfies readonly ModuleImportRegistration[]

export const authAutoImports = [
  { name: 'useConvexAuth', from: './runtime/composables/useConvexAuth' },
  { name: 'useConvexAuthReturnTo', from: './runtime/composables/useConvexAuthReturnTo' },
  { name: 'normalizeLocalRedirectPath', from: './runtime/utils/auth-route-protection' },
] as const satisfies readonly ModuleImportRegistration[]

export const serverAutoImports = [
  { name: 'serverConvex', from: './runtime/server/utils/server-convex-caller' },
  { name: 'getConvexUser', from: './runtime/server/utils/convex-user' },
  { name: 'requireConvexUser', from: './runtime/server/utils/convex-user' },
  { name: 'toConvexH3Error', from: './runtime/server/utils/h3-error' },
] as const satisfies readonly ModuleImportRegistration[]
