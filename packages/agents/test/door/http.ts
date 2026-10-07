import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { httpRouter } from 'convex/server'

import * as agents from './agents'
import { testing } from './fns'

const http = httpRouter()
const mcp = createMcpServer(testing.auth, { name: 'Stress', agents })
for (const method of ['POST', 'GET', 'DELETE'] as const)
  http.route({ path: '/mcp', method, handler: mcp })
export default http
