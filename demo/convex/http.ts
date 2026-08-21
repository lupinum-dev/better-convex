import { httpRouter } from 'convex/server'

import { betterConvexAuth } from './auth'

const http = httpRouter()

// Register all Better Auth routes (/api/auth/*)
betterConvexAuth.registerRoutes(http)

export default http
