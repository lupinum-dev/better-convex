import { defineTools } from '@lupinum/better-convex-agents'
import { anyApi } from 'convex/server'

import { fns } from './fns'
import * as ops from './ops'

// No codegen in the fixture: `anyApi.tools` names this module's functions as `tools:<name>`.
export const tools = defineTools(fns, { ops }, { functions: anyApi.tools as never })

export const { probe_edit, probe_ask, probe_rule, check_approval, housekeeping } = tools.functions

export const { approve, decline } = tools.approvals
