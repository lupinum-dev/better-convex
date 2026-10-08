import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { httpRouter } from 'convex/server'

import { doorAuth } from '../support'
import * as agents from './tools'

// The MCP door over HTTP, for the doors table (../doors.test.ts).
const http = httpRouter()
const mcp = createMcpServer(doorAuth, { name: 'Doors', agents })
for (const method of ['POST', 'GET', 'DELETE'] as const)
  http.route({ path: '/mcp', method, handler: mcp })
export default http
