import { defineTools } from '@lupinum/better-convex-agents'

import { internal } from './_generated/api'
import { fns } from './functions'
import * as listings from './listings'
import * as orders from './orders'

export const tools = defineTools(fns, { listings, orders }, { functions: internal.agents })

export const {
  browse_listings,
  list_orders,
  place_order,
  ship_order,
  cancel_order,
  check_approval,
  housekeeping,
} = tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
