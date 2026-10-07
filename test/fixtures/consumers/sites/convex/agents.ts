import { defineTools } from '@lupinum/better-convex-agents'

import { internal } from './_generated/api'
import { fns } from './functions'
import * as sites from './sites'

/** Every operation with a `tool` field, for MCP hosts. */
export const tools = defineTools(fns, { sites }, { functions: internal.agents })

export const { trigger_site_check, list_site_checks, check_approval, housekeeping } =
  tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
