import { httpRouter } from 'convex/server'

import { auth } from './auth'

const http = httpRouter()
auth.registerRoutes(http)
export default http
