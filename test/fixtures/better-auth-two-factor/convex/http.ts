import { httpRouter } from 'convex/server'

import { betterConvexAuth } from './auth'

const http = httpRouter()
betterConvexAuth.registerRoutes(http)

export default http
