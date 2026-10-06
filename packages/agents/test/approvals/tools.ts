import { defineTools } from '@lupinum/better-convex-agents'
import { anyApi } from 'convex/server'

import { fns } from './fns'
import * as ops from './ops'

// No codegen in the fixture: `anyApi.tools` names this module's functions as `tools:<name>`.
export const tools = defineTools(fns, { ops }, { functions: anyApi.tools as never })

export const {
  list_projects,
  read_project,
  rename_project,
  archive_project,
  export_project,
  tidy_project,
  archive_projects,
  edit_note,
  sneaky_archive,
  edit_notes,
  check_approval,
  housekeeping,
} = tools.functions

export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
