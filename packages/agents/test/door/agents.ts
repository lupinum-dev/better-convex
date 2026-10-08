import { defineTools } from '@lupinum/better-convex-agents'

import { refs } from '../support'
import { fns } from './fns'
import * as projects from './projects'
import * as shapes from './shapes'

export const tools = defineTools(fns, { projects, shapes }, { functions: refs('agents') })

export const {
  create_project,
  archive_project,
  large_report,
  quoted_report,
  rows_report,
  attach_file,
  list_broken,
  list_projects,
  echo_shapes,
  check_approval,
  housekeeping,
} = tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
