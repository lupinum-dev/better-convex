import { definePolicy } from '@lupinum/better-convex-functions/policy'

/**
 * Ginko's roles, minus the publisher: editors change drafts, owners also
 * change what is live. Agents may change live pages only with a person's yes.
 */
export const policy = definePolicy({
  actions: ['pages.read', 'pages.preview', 'pages.edit', 'pages.editLive'],
  roles: {
    owner: ['*'],
    editor: ['pages.preview', 'pages.edit'],
    viewer: ['pages.preview'],
  },
  public: ['pages.read'],
  scopes: {
    read: { label: 'Read pages and drafts', actions: ['pages.read', 'pages.preview'] },
    write: { label: 'Edit pages', actions: ['pages.edit', 'pages.editLive'] },
  },
  agents: { 'pages.editLive': 'approve' },
})
