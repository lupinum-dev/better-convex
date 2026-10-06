import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { httpRouter } from 'convex/server'

import * as agents from './agents'
import { APP_NAME, auth } from './auth'

const http = httpRouter()
// The auth factory supplies the MCP resource, issuer, scopes and token check.
const mcp = createMcpServer(auth, { name: APP_NAME, agents })

auth.registerRoutes(http)
// GET and DELETE reach the handler's deliberate 405 instead of a router 404.
for (const method of ['POST', 'GET', 'DELETE'] as const) {
  http.route({ path: '/mcp', method, handler: mcp })
}
// Credential-free discovery for browser-based clients. Convex serves HEAD through GET.
for (const method of ['GET', 'OPTIONS'] as const) {
  http.route({ path: '/.well-known/oauth-protected-resource/mcp', method, handler: mcp })
}

export default http
