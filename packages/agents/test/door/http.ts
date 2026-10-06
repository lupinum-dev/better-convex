import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { testMcpAuth } from '@lupinum/better-convex-agents/test'
import { httpRouter } from 'convex/server'

import * as agents from './agents'

const http = httpRouter()
const mcp = createMcpServer(testMcpAuth(), { name: 'Stress', agents })
for (const method of ['POST', 'GET', 'DELETE'] as const)
  http.route({ path: '/mcp', method, handler: mcp })
export default http
