export interface ModuleImportRegistration {
  name: string
  from: string
}

export const composableAutoImports = [
  { name: 'useConvex', from: './runtime/composables/useConvex' },
  {
    name: 'useConvexAttachment',
    from: './runtime/composables/useConvexAttachment',
  },
  { name: 'useConvexConfig', from: './runtime/composables/useConvexConfig' },
  {
    name: 'useConvexMutation',
    from: './runtime/composables/useConvexMutation',
  },
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
] as const satisfies readonly ModuleImportRegistration[]

export const serverAutoImports = [
  { name: 'serverConvex', from: './runtime/server/utils/server-convex-caller' },
] as const satisfies readonly ModuleImportRegistration[]
