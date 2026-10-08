import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()
// Expires agent requests and deletes activity past retention.
crons.hourly('agent housekeeping', { minuteUTC: 7 }, internal.agents.housekeeping, {})
// Starts queued site checks.
crons.interval('dispatch site checks', { minutes: 1 }, internal.sites.dispatchChecks, {})
export default crons
