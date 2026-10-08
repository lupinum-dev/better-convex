import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()
// Expires agent requests and deletes activity past retention.
crons.hourly('agent housekeeping', { minuteUTC: 7 }, internal.agents.housekeeping, {})
export default crons
