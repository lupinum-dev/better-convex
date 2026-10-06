import { defineTools } from '@lupinum/better-convex-agents'

import { internal } from './_generated/api'
import { fns } from './functions'
import * as projects from './projects'

/** Every operation with a `tool` field, for MCP hosts. */
export const tools = defineTools(fns, { projects }, { functions: internal.agents })

// One internal function per tool, so logs and usage name the tool.
export const {
  list_organizations,
  search_projects,
  create_project,
  rename_project,
  archive_project,
  check_approval,
  housekeeping,
} = tools.functions

/** Requests from agents that wait for a person, and what agents did. */
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
