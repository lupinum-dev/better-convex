import { defineTools } from '@lupinum/better-convex-agents'

import { internal } from './_generated/api'
import * as clients from './clients'
import * as findings from './findings'
import { fns } from './functions'
import * as projects from './projects'

export const tools = defineTools(
  fns,
  { clients, projects, findings },
  { functions: internal.agents },
)

export const {
  list_clients,
  list_projects,
  get_fix_brief,
  acknowledge_findings,
  check_approval,
  housekeeping,
} = tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
