import { defineTools } from '@lupinum/better-convex-agents'

import { internal } from './_generated/api'
import { fns } from './functions'
import * as pages from './pages'

export const tools = defineTools(fns, { pages }, { functions: internal.agents })

export const { list_pages, read_page, edit_page, edit_live_page, check_approval, housekeeping } =
  tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
