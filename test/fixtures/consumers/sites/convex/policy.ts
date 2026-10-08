import { definePolicy } from '@lupinum/better-convex-functions/policy'

/** Who may do what. Shared by Convex functions, MCP consent and the page (`can`). */
export const policy = definePolicy({
  actions: ['sites.listChecks', 'sites.check'],
  roles: {
    owner: ['*'],
    member: ['sites.*'],
    viewer: ['sites.listChecks'],
  },
  scopes: {
    'mcp:read': { label: 'See the checks of your sites.', actions: ['sites.listChecks'] },
    'mcp:write': {
      label: 'Start a paid site check after you approve it.',
      actions: ['sites.check'],
    },
  },
  // A site check costs money: an agent may ask, a person decides.
  agents: { 'sites.check': 'approve' },
})
