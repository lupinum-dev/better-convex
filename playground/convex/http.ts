import { httpRouter } from 'convex/server'

import { auth } from './auth'

const http = httpRouter()

// Register all Better Auth routes (/api/auth/*)
auth.registerRoutes(http)

export default http
