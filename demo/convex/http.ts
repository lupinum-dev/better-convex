import { httpRouter } from 'convex/server'

import { authComponent, createAuth } from './auth'

const http = httpRouter()

// Register all Better Auth routes (/api/auth/*)
authComponent.registerRoutes(http, createAuth)

export default http
