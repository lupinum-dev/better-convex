import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { httpRouter } from 'convex/server'

import { doorAuth } from '../support'
import * as agents from './agents'

const http = httpRouter()
const mcp = createMcpServer(doorAuth, { name: 'Stress', agents })
for (const method of ['POST', 'GET', 'DELETE'] as const)
  http.route({ path: '/mcp', method, handler: mcp })
export default http
