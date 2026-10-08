import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { httpRouter } from 'convex/server'

import * as agents from './agents'
import { APP_NAME, auth } from './auth'

const http = httpRouter()
const mcp = createMcpServer(auth, { name: APP_NAME, agents })

auth.registerRoutes(http)
for (const method of ['POST', 'GET', 'DELETE'] as const) {
  http.route({ path: '/mcp', method, handler: mcp })
}

export default http
