import { definePolicy } from '@lupinum/better-convex-functions/policy'

/** Who may do what. Shared by Convex functions, MCP consent and the page (`can`). */
export const policy = definePolicy({
  actions: [
    'organizations.list',
    'projects.search',
    'projects.create',
    'projects.rename',
    'projects.archive',
  ],
  roles: {
    owner: ['*'],
    admin: ['organizations.list', 'projects.*'],
    member: ['organizations.list', 'projects.search', 'projects.create', 'projects.rename'],
    viewer: ['organizations.list', 'projects.search'],
  },
  // The consent page shows each label; a host sees only the tools of the scopes a person granted.
  scopes: {
    'mcp:read': {
      label: 'See your organizations and find their projects.',
      actions: ['organizations.list', 'projects.search'],
    },
    'mcp:write': {
      label: 'Create and rename projects, and archive a project after you approve it.',
      actions: ['projects.create', 'projects.rename', 'projects.archive'],
    },
  },
  // 30 new projects a minute per person is far more than a person types; it stops a loop.
  limits: { 'projects.create': { max: 30, every: 'minute' } },
  // Who archived what, and which rows the call changed. No values are stored.
  audit: ['projects.archive'],
  agents: { 'projects.archive': 'approve' },
  // An owner or admin of the organization may decide a teammate's agent request too.
  approvers: { 'projects.archive': ['owner', 'admin'] },
})
