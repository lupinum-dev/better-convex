import { definePolicy } from '@lupinum/better-convex-functions/policy'

/**
 * An agency monitors its clients' sites (website-checker). Agency people work
 * on every client; a client's own people read their sites and briefs.
 */
export const policy = definePolicy({
  actions: [
    'clients.list',
    'projects.list',
    'projects.create',
    'findings.brief',
    'findings.acknowledge',
  ],
  roles: {
    owner: ['*'],
    staff: ['clients.list', 'projects.*', 'findings.*'],
    client: ['projects.list', 'findings.brief'],
  },
  scopes: {
    read: {
      label: 'See your clients, sites and fix briefs',
      actions: ['clients.list', 'projects.list', 'findings.brief'],
    },
    write: { label: 'Acknowledge findings', actions: ['findings.acknowledge'] },
  },
  agents: { 'findings.acknowledge': 'approve' },
  // An agency owner may decide what a staff member's agent asks for.
  approvers: { 'findings.acknowledge': ['owner'] },
})
