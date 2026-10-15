import { defineTools } from '@lupinum/better-convex-agents'

import { refs } from '../support'
import { fns } from './fns'
import * as projects from './projects'
import * as shapes from './shapes'

export const tools = defineTools(
  fns,
  { projects, shapes },
  {
    functions: refs('agents'),
    uploads: { scopes: ['write'], types: ['application/pdf', 'text/csv'], maxBytes: 1024 },
  },
)

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
  take_upload,
  take_upload_as,
  take_upload_approved,
  take_upload_twice,
  check_approval,
  housekeeping,
  request_upload,
  upload_ticket,
  upload_stored,
} = tools.functions
export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
