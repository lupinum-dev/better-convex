import { definePolicy } from '@lupinum/better-convex-functions/policy'

/** Organizations sell listings to each other; an order belongs to the buyer and the seller. */
export const policy = definePolicy({
  actions: ['listings.browse', 'orders.list', 'orders.place', 'orders.ship', 'orders.cancel'],
  roles: {
    owner: ['*'],
    member: ['listings.browse', 'orders.*'],
    viewer: ['listings.browse', 'orders.list'],
  },
  scopes: {
    read: { label: 'See listings and orders', actions: ['listings.browse', 'orders.list'] },
    write: {
      label: 'Place, ship and cancel orders',
      actions: ['orders.place', 'orders.ship', 'orders.cancel'],
    },
  },
  agents: { 'orders.cancel': 'approve' },
  // The order is the seller's too: its owners may decide a buyer agent's cancel.
  approvers: { 'orders.cancel': { roles: ['owner'], sharedRows: true } },
})
