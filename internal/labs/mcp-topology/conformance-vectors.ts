/** Shared data only. Each topology owns its own server, transport, identity, and application adapter. */
export const topologyConformanceVectors = Object.freeze({
  expectedTools: [
    'delete_workspace',
    'generate_report',
    'get_workspace_deletion_status',
    'rename_note',
    'search_notes',
  ] as const,
  malformedSearch: {
    arguments: {
      query: '',
      subject: 'bob',
      workspaceId: 'workspace-b',
    },
    name: 'search_notes',
  } as const,
  rename: {
    first: {
      arguments: {
        noteId: 'note-a',
        requestKey: 'rename-a',
        title: 'Alpha renamed',
      },
      name: 'rename_note',
    } as const,
    conflicting: {
      arguments: {
        noteId: 'note-a',
        requestKey: 'rename-a',
        title: 'Different title',
      },
      name: 'rename_note',
    } as const,
  },
  resource: { uri: 'note://note-a' } as const,
  search: {
    allowed: {
      arguments: { query: '', workspaceId: 'workspace-a' },
      name: 'search_notes',
    } as const,
    crossTenant: {
      arguments: { query: '', workspaceId: 'workspace-b' },
      name: 'search_notes',
    } as const,
  },
})
