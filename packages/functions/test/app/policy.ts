import { definePolicy } from '@lupinum/better-convex-functions'

/** Who may do what. Shared by Convex functions, MCP consent and the page (`can`). */
export const policy = definePolicy({
  actions: [
    'organizations.list',
    'projects.search',
    'projects.create',
    'projects.rename',
    'projects.archive',
    'clients.create',
  ],
  roles: {
    owner: ['*'],
    member: ['organizations.list', 'projects.search', 'projects.create', 'projects.rename'],
    viewer: ['organizations.list', 'projects.search'],
  },
  scopes: {
    'projects:read': {
      label: 'See your organizations and find their projects.',
      actions: ['organizations.list', 'projects.search'],
    },
    'projects:write': {
      label: 'Create, rename and archive projects.',
      actions: ['projects.create', 'projects.rename', 'projects.archive'],
    },
  },
  agents: { 'projects.archive': 'approve' },
})
